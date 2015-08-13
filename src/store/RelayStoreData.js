/**
 * Copyright 2013-2015, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule RelayStoreData
 * @flow
 * @typechecks
 */

'use strict';

var GraphQLStoreChangeEmitter = require('GraphQLStoreChangeEmitter');
var GraphQLStoreDataHandler = require('GraphQLStoreDataHandler');
var RelayChangeTracker = require('RelayChangeTracker');
var RelayConnectionInterface = require('RelayConnectionInterface');
import type {ChangeSet} from 'RelayChangeTracker';
import type {
  ClientMutationID,
  DataID,
  UpdateOptions
} from 'RelayInternalTypes';
var RelayNodeInterface = require('RelayNodeInterface');
var RelayProfiler = require('RelayProfiler');
var RelayQuery = require('RelayQuery');
var RelayQueryTracker = require('RelayQueryTracker');
var RelayQueryWriter = require('RelayQueryWriter');
var RelayRecordStore = require('RelayRecordStore');
import type {
  CacheManager,
  NodeRangeMap,
  Records,
  RootCallMap
} from 'RelayRecordStore';
var RelayStoreGarbageCollector = require('RelayStoreGarbageCollector');

var forEachObject = require('forEachObject');
var invariant = require('invariant');
var generateForceIndex = require('generateForceIndex');
var refragmentRelayQuery = require('refragmentRelayQuery');
var resolveImmediate = require('resolveImmediate');
var warning = require('warning');
var writeRelayQueryPayload = require('writeRelayQueryPayload');
var writeRelayUpdatePayload = require('writeRelayUpdatePayload');

var {CLIENT_MUTATION_ID} = RelayConnectionInterface;

// The source of truth for application data.
var _instance;

/**
 * @internal
 *
 * Wraps the data caches and associated metadata tracking objects used by
 * GraphQLStore/RelayStore.
 */
class RelayStoreData {
  _cacheManager: ?CacheManager;
  _cachePopulated: boolean;
  _cachedRecords: Records;
  _cachedRootCalls: RootCallMap;
  _garbageCollector: ?RelayStoreGarbageCollector;
  _nodeRangeMap: NodeRangeMap;
  _records: Records;
  _queuedRecords: Records;
  _queuedStore: RelayRecordStore;
  _recordStore: RelayRecordStore;
  _queryTracker: RelayQueryTracker;
  _rootCalls: RootCallMap;

  /**
   * Get the data set backing actual Relay operations. Used in GraphQLStore.
   */
  static getDefaultInstance(): RelayStoreData {
    if (!_instance) {
      _instance = new RelayStoreData();
    }
    return _instance;
  }

  constructor() {
    var cachedRecords: Records = ({}: $FixMe);
    var cachedRootCallMap: RootCallMap = {};
    var queuedRecords: Records = ({}: $FixMe);
    var records: Records = ({}: $FixMe);
    var rootCallMap: RootCallMap = {};
    var nodeRangeMap: NodeRangeMap = ({}: $FixMe);

    this._cacheManager = null;
    this._cachePopulated = true;
    this._cachedRecords = cachedRecords;
    this._cachedRootCalls = cachedRootCallMap;
    this._nodeRangeMap = nodeRangeMap;
    this._records = records;
    this._queuedRecords = queuedRecords;
    this._queuedStore = new RelayRecordStore(
      ({cachedRecords, queuedRecords, records}: $FixMe),
      ({cachedRootCallMap, rootCallMap}: $FixMe),
      (nodeRangeMap: $FixMe)
    );
    this._recordStore = new RelayRecordStore(
      ({records}: $FixMe),
      ({rootCallMap}: $FixMe),
      (nodeRangeMap: $FixMe)
    );
    this._queryTracker = new RelayQueryTracker();
    this._rootCalls = rootCallMap;
  }

  /**
   * Creates a garbage collector for this instance. After initialization all
   * newly added DataIDs will be registered in the created garbage collector.
   * This will show a warning if data has already been added to the instance.
   */
  initializeGarbageCollector(): void {
    invariant(
      !this._garbageCollector,
      'RelayStoreData: Garbage collector is already initialized.'
    );
    var shouldInitialize = this._isStoreDataEmpty();
    warning(
      shouldInitialize,
      'RelayStoreData: Garbage collection can only be initialized when no ' +
      'data is present.'
    );
    if (shouldInitialize) {
      this._garbageCollector = new RelayStoreGarbageCollector(this);
    }
  }

  /**
   * Sets/clears the cache manager that is used to cache changes written to
   * the store.
   */
  injectCacheManager(cacheManager: ?CacheManager): void {
    var cachedRecords = this._cachedRecords;
    var cachedRootCallMap = this._cachedRootCalls;
    var rootCallMap = this._rootCalls;
    var queuedRecords = this._queuedRecords;
    var records = this._records;

    this._cacheManager = cacheManager;
    this._cachePopulated = false;
    this._queuedStore = new RelayRecordStore(
      ({cachedRecords, queuedRecords, records}: $FixMe),
      ({cachedRootCallMap, rootCallMap}: $FixMe),
      (this._nodeRangeMap: $FixMe),
      cacheManager
    );
    this._recordStore = new RelayRecordStore(
      ({records}: $FixMe),
      ({rootCallMap}: $FixMe),
      (this._nodeRangeMap: $FixMe),
      cacheManager
    );
  }

  /**
   * Runs the callback after all data has been read out from diskc cache into
   * cachedRecords
   */
  runWithDiskCache(callback: () => void): void {
    if (this._cachePopulated || !this._cacheManager) {
      resolveImmediate(callback);
    } else {
      this._cacheManager.readAllData(
        this._cachedRecords,
        this._cachedRootCalls,
        () => {
          this._cachePopulated = true;
          callback();
        }
      );
    }
  }

  /**
   * Write the results of a query into the base record store.
   */
  handleQueryPayload(
    query: RelayQuery.Root,
    response: {[key: string]: mixed},
    forceIndex: ?number
  ): void {
    var changeTracker = new RelayChangeTracker();
    var writer = new RelayQueryWriter(
      this._recordStore,
      this._queryTracker,
      changeTracker,
      {
        forceIndex,
        updateTrackedQueries: true,
      }
    );
    writeRelayQueryPayload(
      writer,
      query,
      response
    );
    this._handleChangedAndNewDataIDs(changeTracker.getChangeSet());
  }

  /**
   * Write the results of an update into the base record store.
   */
  handleUpdatePayload(
    operation: RelayQuery.Operation,
    payload: {[key: string]: mixed},
    {configs, isOptimisticUpdate}: UpdateOptions
  ): void {
    var changeTracker = new RelayChangeTracker();
    var store = isOptimisticUpdate ?
      this.getRecordStoreForOptimisticMutation(payload[CLIENT_MUTATION_ID]) :
      this._recordStore;
    var writer = new RelayQueryWriter(
      store,
      this._queryTracker,
      changeTracker,
      {
        forceIndex: generateForceIndex(),
        updateTrackedQueries: false,
      }
    );
    writeRelayUpdatePayload(
      writer,
      operation,
      payload,
      {configs, isOptimisticUpdate}
    );
    this._handleChangedAndNewDataIDs(changeTracker.getChangeSet());
  }

  /**
   * Given a query fragment and a data ID, returns a root query that applies
   * the fragment to the object specified by the data ID.
   */
  buildFragmentQueryForDataID(
    fragment: RelayQuery.Fragment,
    dataID: DataID
  ): RelayQuery.Root {
    if (GraphQLStoreDataHandler.isClientID(dataID)) {
      var path = this._queuedStore.getPathToRecord(dataID);
      invariant(
        path,
        'RelayStoreData.buildFragmentQueryForDataID(): Cannot refetch ' +
        'record `%s` without a path.',
        dataID
      );
      var query = refragmentRelayQuery(path.getQuery(fragment));
      invariant(
        query,
        'RelayStoreData.buildFragmentQueryForDataID(): Expected a query for ' +
        'record `%s`.',
        dataID
      );
      return query;
    }
    return RelayQuery.Node.buildRoot(
      RelayNodeInterface.NODE,
      dataID,
      fragment.getChildren(),
      {rootArg: RelayNodeInterface.ID},
      fragment.getDebugName() || 'UnknownQuery'
    );
  }

  getNodeData(): Records {
    return this._records;
  }

  getQueuedData(): Records {
    return this._queuedRecords;
  }

  clearQueuedData(): void {
    forEachObject(this._queuedRecords, (_, key) => {
      delete this._queuedRecords[key];
      GraphQLStoreChangeEmitter.broadcastChangeForID(key);
    });
  }

  getCachedData(): Records {
    return this._cachedRecords;
  }

  getGarbageCollector(): ?RelayStoreGarbageCollector {
    return this._garbageCollector;
  }

  /**
   * Get the record store with full data (cached, base, queued).
   */
  getQueuedStore(): RelayRecordStore {
    return this._queuedStore;
  }

  /**
   * Get the record store with only the base data (no queued/cached data).
   */
  getRecordStore(): RelayRecordStore {
    return this._recordStore;
  }

  getQueryTracker(): RelayQueryTracker {
    return this._queryTracker;
  }

  /**
   * @deprecated
   *
   * Used temporarily by GraphQLStore, but all updates to this object are now
   * handled through a `RelayRecordStore` instance.
   */
  getRootCallData(): RootCallMap {
    return this._rootCalls;
  }

  _isStoreDataEmpty(): boolean {
    return (
      Object.keys(this._records).length === 0 &&
      Object.keys(this._queuedRecords).length === 0 &&
      Object.keys(this._cachedRecords).length === 0
    );
  }

  /**
   * Given a ChangeSet, broadcasts changes for updated DataIDs
   * and registers new DataIDs with the garbage collector.
   */
  _handleChangedAndNewDataIDs(changeSet: ChangeSet): void {
    var updatedDataIDs = Object.keys(changeSet.updated);
    updatedDataIDs.forEach(
      GraphQLStoreChangeEmitter.broadcastChangeForID
    );
    if (this._garbageCollector) {
      var createdDataIDs = Object.keys(changeSet.created);
      var garbageCollector = this._garbageCollector;
      createdDataIDs.forEach(dataID => garbageCollector.register(dataID));
    }
  }

  getRecordStoreForOptimisticMutation(
    clientMutationID: ClientMutationID
  ): RelayRecordStore {
    var cachedRecords = this._cachedRecords;
    var cachedRootCallMap = this._cachedRootCalls;
    var rootCallMap = this._rootCalls;
    var queuedRecords = this._queuedRecords;
    var records = this._records;

    return new RelayRecordStore(
      ({cachedRecords, queuedRecords, records}: $FixMe),
      ({cachedRootCallMap, rootCallMap}: $FixMe),
      (this._nodeRangeMap: $FixMe),
      (this._cacheManager: ?CacheManager),
      clientMutationID
    );
  }
}

RelayProfiler.instrumentMethods(RelayStoreData.prototype, {
  handleQueryPayload: 'RelayStoreData.prototype.handleQueryPayload',
});

module.exports = RelayStoreData;
