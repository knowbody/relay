/**
 * Copyright 2013-2015, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @emails oncall+relay
 */

'use strict';

var RelayTestUtils = require('RelayTestUtils');
RelayTestUtils.unmockRelay();

jest.dontMock('GraphQLDeferredQueryTracker');

describe('GraphQLDeferredQueryTracker', () => {
  var GraphQLDeferredQueryTracker;
  var Relay;
  var RelayStoreData;

  var flattenSplitRelayQueries;
  var splitDeferredRelayQueries;

  var {defer, getNode} = RelayTestUtils;

  var recordStore;

  function splitQueries(query) {
    return flattenSplitRelayQueries(splitDeferredRelayQueries(query));
  }

  beforeEach(() => {
    jest.resetModuleRegistry();

    GraphQLDeferredQueryTracker = require('GraphQLDeferredQueryTracker');
    Relay = require('Relay');
    RelayStoreData = require('RelayStoreData');

    flattenSplitRelayQueries = require('flattenSplitRelayQueries');
    getWeakIdForObject = require('getWeakIdForObject');
    splitDeferredRelayQueries = require('splitDeferredRelayQueries');

    recordStore = RelayStoreData.getDefaultInstance().getRecordStore();
  });

  it('should fire callbacks when deferred data fails', () => {
    var mockFragment = Relay.QL`fragment on Node{name}`;
    var mockQuery = getNode(Relay.QL`
      query {
        node(id:"4") {
          id,
          ${defer(mockFragment)},
        }
      }
    `);
    var split = splitQueries(mockQuery);
    var mockDeferred = split[1];
    var dataID = '4';
    var fragmentID = getNode(mockFragment).getFragmentID();
    var onSuccess = jest.genMockFunction();
    var onFailure = jest.genMockFunction();

    GraphQLDeferredQueryTracker.addListenerForFragment(
      dataID,
      fragmentID,
      {
        onSuccess: onSuccess,
        onFailure: onFailure,
      }
    );
    GraphQLDeferredQueryTracker.recordQuery(mockDeferred);
    expect(onFailure).not.toBeCalled();

    var error = new Error();
    GraphQLDeferredQueryTracker.rejectQuery(mockDeferred, error);
    jest.runAllTimers();
    expect(onFailure).toBeCalled();
    expect(onFailure).toBeCalledWith(dataID, fragmentID, error);
    expect(onSuccess).not.toBeCalled();
  });

  it('should fire callbacks when deferred data resolves', () => {
    var mockFragment = Relay.QL`fragment on Node{name}`;
    var mockQuery = getNode(Relay.QL`
      query {
        node(id:"4") {
          id,
          ${defer(mockFragment)},
        }
      }
    `);
    var split = splitQueries(mockQuery);
    var mockDeferred = split[1];
    var dataID = '4';
    var fragmentID = getNode(mockFragment).getFragmentID();
    var onSuccess = jest.genMockFunction();
    var onFailure = jest.genMockFunction();

    GraphQLDeferredQueryTracker.addListenerForFragment(
      dataID,
      fragmentID,
      {
        onSuccess: onSuccess,
      }
    );
    GraphQLDeferredQueryTracker.recordQuery(mockDeferred);
    expect(onSuccess).not.toBeCalled();

    GraphQLDeferredQueryTracker.resolveQuery(mockDeferred);
    jest.runAllTimers();
    expect(onSuccess).toBeCalledWith(dataID, fragmentID);
    expect(onFailure).not.toBeCalled();
  });

  it('should not fire removed callbacks', () => {
    var mockFragment = Relay.QL`fragment on Node{name}`;
    var mockQuery = getNode(Relay.QL`
      query {
        node(id:"4") {
          id,
          ${defer(mockFragment)},
        }
      }
    `);
    var split = splitQueries(mockQuery);
    var mockDeferred = split[1];
    var dataID = '4';
    var fragmentID = getNode(mockFragment).getFragmentID();
    var onSuccess = jest.genMockFunction();
    var onFailure = jest.genMockFunction();

    var subscription = GraphQLDeferredQueryTracker.addListenerForFragment(
      dataID,
      fragmentID,
      {onSuccess, onFailure}
    );
    subscription.remove();
    GraphQLDeferredQueryTracker.recordQuery(mockDeferred);

    GraphQLDeferredQueryTracker.resolveQuery(mockDeferred);
    jest.runAllTimers();
    expect(onSuccess).not.toBeCalled();
    expect(onFailure).not.toBeCalled();
  });

  it('can only remove callback subscriptions once', () => {
    var onSuccess = jest.genMockFunction();
    var onFailure = jest.genMockFunction();
    var subscription = GraphQLDeferredQueryTracker.addListenerForFragment(
      '842472',
      'fragmentID',
      {onSuccess, onFailure}
    );
    subscription.remove();
    expect(() => subscription.remove()).toThrow();
  });

  it('should have a pending query if deferred query matches', () => {
    var mockFragment = Relay.QL`fragment on Node{name}`;
    var mockQuery = getNode(Relay.QL`
      query {
        node(id:"4") {
          id,
          ${defer(mockFragment)},
        }
      }
    `);
    var split = splitQueries(mockQuery);
    var mockDeferred = split[1];

    var dataID = '4';
    var fragmentID = getNode(mockFragment).getFragmentID();
    GraphQLDeferredQueryTracker.recordQuery(mockDeferred);
    expect(
      GraphQLDeferredQueryTracker.isQueryPending(dataID, fragmentID)
    ).toBe(true);

    GraphQLDeferredQueryTracker.resolveQuery(mockDeferred);
    expect(
      GraphQLDeferredQueryTracker.isQueryPending(dataID, fragmentID)
    ).toBe(false);
  });

  it('should not have a pending query if required query matches', () => {
    var mockFragment = Relay.QL`fragment on Node{name}`;
    var mockQuery = getNode(Relay.QL`
      query {
        node(id:"4") {
          id,
          ${mockFragment},
        }
      }
    `);
    var split = splitQueries(mockQuery);

    var dataID = '4';
    var fragmentID = getNode(mockFragment).getFragmentID();
    GraphQLDeferredQueryTracker.recordQuery(split[0]);
    expect(
      GraphQLDeferredQueryTracker.isQueryPending(dataID, fragmentID)
    ).toBe(false);

    GraphQLDeferredQueryTracker.resolveQuery(split[0]);
    expect(
      GraphQLDeferredQueryTracker.isQueryPending(dataID, fragmentID)
    ).toBe(false);
  });

  describe('deferred query with unknown ids for root call', () => {
    it('returns the correct pending status when parent query resolves', () => {
      var mockFragment = Relay.QL`fragment on Node{name}`;
      var mockQuery = getNode(Relay.QL`
        query {
          me {
            id,
            ${defer(mockFragment)},
          }
        }
      `);
      var split = splitQueries(mockQuery);
      var mockRequired = split[0];
      var mockDeferred = split[1];

      var dataID = '4';
      var fragmentID = getNode(mockFragment).getFragmentID();
      GraphQLDeferredQueryTracker.recordQuery(mockRequired);
      GraphQLDeferredQueryTracker.recordQuery(mockDeferred);

      // `isQueryPending` can only be used when the dataID is known. the dataID
      // of `me()` is unknown so the pending status is undetermined:
      // the tracker returns false because the id does not match a known query.
      expect(
        GraphQLDeferredQueryTracker.isQueryPending(dataID, fragmentID)
      ).toBe(false);

      // resolving the parent query allows the tracker to determine the ID of
      // the unresolved deferred query
      recordStore.putRootCallID('me', null, dataID);
      GraphQLDeferredQueryTracker.resolveQuery(mockRequired);
      expect(
        GraphQLDeferredQueryTracker.isQueryPending(dataID, fragmentID)
      ).toBe(true);

      GraphQLDeferredQueryTracker.resolveQuery(mockDeferred);
      expect(
        GraphQLDeferredQueryTracker.isQueryPending(dataID, fragmentID)
      ).toBe(false);
    });

    it('returns the correct pending status when parent query fails', () => {
      var mockFragment = Relay.QL`fragment on Node{name}`;
      var mockQuery = getNode(Relay.QL`
        query {
          me {
            id,
            ${defer(mockFragment)},
          }
        }
      `);
      var split = splitQueries(mockQuery);
      var mockRequired = split[0];
      var mockDeferred = split[1];

      var dataID = '4';
      var fragmentID = getNode(mockFragment).getFragmentID();
      GraphQLDeferredQueryTracker.recordQuery(mockRequired);
      GraphQLDeferredQueryTracker.recordQuery(mockDeferred);

      // if the parent query fails the root call id is unresolved; the deferred
      // query's status cannot be determined and defaults to false
      // because the dataID/fragmentID cannot be matched to any pending
      // queries.
      GraphQLDeferredQueryTracker.rejectQuery(mockRequired, new Error('wtf'));
      expect(
        GraphQLDeferredQueryTracker.isQueryPending(dataID, fragmentID)
      ).toBe(false);

      // the root call ID can also be resolved via the deferred query,
      // and we now know that the query is not pending.
      recordStore.putRootCallID('me', null, dataID);
      GraphQLDeferredQueryTracker.resolveQuery(mockDeferred);
      expect(
        GraphQLDeferredQueryTracker.isQueryPending(dataID, fragmentID)
      ).toBe(false);
    });

    it(
      'returns the correct pending status when a parent resolves after the ' +
      'child query',
      () => {
        var mockFragment = Relay.QL`fragment on Node{name}`;
        var mockQuery = getNode(Relay.QL`
          query {
            me {
              id,
              ${defer(mockFragment)},
            }
          }
        `);
        var split = splitQueries(mockQuery);
        var mockRequired = split[0];
        var mockDeferred = split[1];

        var dataID = '4';

        var fragmentID = getNode(mockFragment).getFragmentID();
        GraphQLDeferredQueryTracker.recordQuery(mockRequired);
        GraphQLDeferredQueryTracker.recordQuery(mockDeferred);

        GraphQLDeferredQueryTracker.rejectQuery(mockDeferred, new Error('wtf'));
        recordStore.putRootCallID('me', null, dataID);
        GraphQLDeferredQueryTracker.resolveQuery(mockRequired);

        // deferred query should not be considered pending
        expect(
          GraphQLDeferredQueryTracker.isQueryPending(dataID, fragmentID)
        ).toBe(false);
      }
    );
  });

  describe('deferred query with ref params', () => {
    it('returns the correct pending status when parent query resolves', () => {
      var mockFragment = Relay.QL`fragment on Page{backgroundImage{uri}}`;
      var mockQuery = getNode(Relay.QL`
        query {
          node(id:"4") {
            id,
            name,
            hometown {
              ${defer(mockFragment)},
            },
          }
        }
      `);
      var split = splitQueries(mockQuery);
      var mockRequired = split[0];
      var mockDeferred = split[1];

      var dataID = 'pageID';
      var fragmentID = getNode(mockFragment).getFragmentID();
      GraphQLDeferredQueryTracker.recordQuery(mockRequired);
      GraphQLDeferredQueryTracker.recordQuery(mockDeferred);

      // `isQueryPending` can only be used when the dataID is known. the dataID
      // of `me()` is unknown so the pending status is undetermined:
      // the tracker returns false because the id does not match a known query.
      expect(
        GraphQLDeferredQueryTracker.isQueryPending(dataID, fragmentID)
      ).toBe(false);

      // resolving the parent query allows the tracker to determine the ID of
      // the unresolved deferred query
      var response = {'4': {hometown: {id: dataID}}};
      GraphQLDeferredQueryTracker.resolveQuery(mockRequired, response);
      expect(
        GraphQLDeferredQueryTracker.isQueryPending(dataID, fragmentID)
      ).toBe(true);

      GraphQLDeferredQueryTracker.resolveQuery(
        mockDeferred,
        null,
        {ref_q1: dataID}
      );
      expect(
        GraphQLDeferredQueryTracker.isQueryPending(dataID, fragmentID)
      ).toBe(false);
    });

    it('returns the correct pending status when parent query fails', () => {
      var mockFragment = Relay.QL`fragment on Page{backgroundImage{uri}}`;
      var mockQuery = getNode(Relay.QL`
        query {
          node(id:"4") {
            id,
            name,
            hometown {
              ${defer(mockFragment)},
            },
          }
        }
      `);
      var split = splitQueries(mockQuery);
      var mockRequired = split[0];
      var mockDeferred = split[1];

      var dataID = 'pageID';
      var fragmentID = getNode(mockFragment).getFragmentID();
      GraphQLDeferredQueryTracker.recordQuery(mockRequired);
      GraphQLDeferredQueryTracker.recordQuery(mockDeferred);

      // if the parent query fails the root call id is unresolved; the deferred
      // query's status cannot be determined and defaults to false
      // because the dataID/fragmentID cannot be matched to any pending
      // queries.
      GraphQLDeferredQueryTracker.rejectQuery(mockRequired, new Error('wtf'));
      expect(
        GraphQLDeferredQueryTracker.isQueryPending(dataID, fragmentID)
      ).toBe(false);

      // the child probably will not be remapped if the parent failed. Even if
      // the response somehow comes back, we will still think it is pending.
      GraphQLDeferredQueryTracker.resolveQuery(
        mockDeferred,
        null,
        {ref_q1: dataID}
      );
      expect(
        GraphQLDeferredQueryTracker.isQueryPending(dataID, fragmentID)
      ).toBe(false);
    });
  });

  it(
    'returns the correct pending status when query is recorded after ' +
    'rootcall is associated with an id',
    () => {
      var mockFragment = Relay.QL`fragment on Node{name}`;
      var mockQuery = getNode(Relay.QL`
        query {
          me {
            id,
            ${defer(mockFragment)},
          }
        }
      `);
      var split = splitQueries(mockQuery);
      var mockDeferred = split[1];

      var dataID = '4';
      recordStore.putRootCallID('me', null, dataID);

      var fragmentID = getNode(mockFragment).getFragmentID();
      GraphQLDeferredQueryTracker.recordQuery(mockDeferred);

      expect(
        GraphQLDeferredQueryTracker.isQueryPending(dataID, fragmentID)
      ).toBe(true);

      GraphQLDeferredQueryTracker.resolveQuery(mockDeferred);
      expect(
        GraphQLDeferredQueryTracker.isQueryPending(dataID, fragmentID)
      ).toBe(false);
    }
  );
});
