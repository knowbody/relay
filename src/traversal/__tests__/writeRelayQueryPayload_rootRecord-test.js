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

jest
  .dontMock('GraphQLRange')
  .dontMock('GraphQLSegment');

describe('writeRelayQueryPayload()', () => {
  var Relay;
  var RelayRecordStore;

  var {getNode, getRefNode, writePayload} = RelayTestUtils;

  beforeEach(() => {
    jest.resetModuleRegistry();

    Relay = require('Relay');
    RelayRecordStore = require('RelayRecordStore');

    jest.addMatchers(RelayTestUtils.matchers);
  });

  describe('root record', () => {

    it('is created for argument-less custom root calls with an id', () => {
      var records = {};
      var store = new RelayRecordStore({records});
      var query = getNode(Relay.QL`
        query {
          me {
            id,
          }
        }
      `);
      var payload = {
        me: {
          id: '123'
        }
      };
      var results = writePayload(store, query, payload);
      expect(results).toEqual({
        created: {
          123: true
        },
        updated: {}
      });
      expect(store.getRecordStatus('123')).toBe('EXISTENT');
      expect(store.getField('123', 'id')).toBe('123');
      expect(store.getRootCallID('me', null)).toBe('123');
    });

    it('is created for argument-less custom root calls without an id', () => {
      var records = {};
      var store = new RelayRecordStore({records});
      var query = getNode(Relay.QL`
        query {
          viewer {
            actor {
              id,
            },
          }
        }
      `);
      var payload = {
        viewer: {
          actor: {
            id: '123'
          }
        }
      };
      var results = writePayload(store, query, payload);
      expect(results).toEqual({
        created: {
          'client:viewer': true,
          '123': true
        },
        updated: {}
      });
      expect(store.getRecordStatus('client:viewer')).toBe('EXISTENT');
      expect(store.getLinkedRecordID('client:viewer', 'actor')).toBe('123');
      expect(store.getRootCallID('viewer', null)).toBe('client:viewer');
    });

    it('is created for custom root calls with an id', () => {
      var records = {};
      var store = new RelayRecordStore({records});
      var query = getNode(Relay.QL`
        query {
          username(name:"yuzhi") {
            id,
          }
        }
      `);
      var payload = {
        yuzhi: {
          id: '1055790163'
        }
      };
      var results = writePayload(store, query, payload);
      expect(results).toEqual({
        created: {
          '1055790163': true
        },
        updated: {}
      });
      expect(store.getRecordStatus('1055790163')).toBe('EXISTENT');
      expect(store.getField('1055790163', 'id')).toBe('1055790163');
      expect(store.getRootCallID('username', 'yuzhi')).toBe('1055790163');
    });

    it('is created for custom root calls without an id', () => {
      var records = {};
      var store = new RelayRecordStore({records});
      // note: this test simulates an `id`-less root call
      var query = getNode(Relay.QL`
        query {
          username(name:"yuzhi") {
            name,
          }
        }
      `);
      // remove the autogenerated `id` field
      query = query.clone(query.getChildren().slice(0, 1));
      // no `id` value is present, so the root ID is autogenerated
      var payload = {
        'yuzhi': {
          name: 'Yuzhi Zheng'
        }
      };
      var results = writePayload(store, query, payload);
      expect(results).toEqual({
        created: {
          'client:1': true
        },
        updated: {}
      });
      expect(store.getRecordStatus('client:1')).toBe('EXISTENT');
      expect(store.getField('client:1', 'name')).toBe('Yuzhi Zheng');
      expect(store.getRootCallID('username', 'yuzhi')).toBe('client:1');
    });

    it('is created for custom root calls with batch call variables', () => {
      var records = {};
      var store = new RelayRecordStore({records});
      var query = getRefNode(Relay.QL`
        query {
          node(id:$ref_q0) {
            id
          }
        }
      `, {path: '$.*.id'}); // This path is bogus.
      var payload = {
        '123': {
          id: '123'
        }
      };
      var results = writePayload(store, query, payload);
      expect(results).toEqual({
        created: {
          '123': true
        },
        updated: {}
      });
      expect(store.getRecordStatus('123')).toBe('EXISTENT');
      expect(store.getField('123', 'id')).toBe('123');
    });

    it('requires arguments to `node()` root calls', () => {
      var records = {};
      var store = new RelayRecordStore({records});
      var query = getNode(Relay.QL`
        query {
          node {
            id
          }
        }
      `);
      var payload = {
        '123': null
      };
      expect(() => {
        writePayload(store, query, payload);
      }).toFailInvariant(
        'RelayRecordStore.getRootCallID(): Argument to `node()` cannot be ' +
        'null or undefined.'
      );
    });

    it('is created and set to null when the response is null', () => {
      var records = {};
      var store = new RelayRecordStore({records});
      var query = getNode(Relay.QL`
        query {
          node(id:"123") {
            id
          }
        }
      `);
      var payload = {
        '123': null
      };
      var results = writePayload(store, query, payload);
      expect(results).toEqual({
        created: {},
        updated: {}
      });
      expect(store.getRecordStatus('123')).toBe('NONEXISTENT');
    });

    it('is deleted when a response returns null', () => {
      var records = {
        '123': {
          __dataID__: '123',
          id: '123'
        }
      };
      var store = new RelayRecordStore({records});
      var query = getNode(Relay.QL`
        query {
          node(id:"123") {
            id
          }
        }
      `);
      var payload = {
        '123': null
      };
      var results = writePayload(store, query, payload);
      expect(results).toEqual({
        created: {},
        updated: {
          '123': true
        }
      });
      expect(store.getRecordStatus('123')).toBe('NONEXISTENT');
    });

    it('requires an unambiguous response', () => {
      var records = {};
      var store = new RelayRecordStore({records});
      var query = getNode(Relay.QL`
        query {
          me {
            id
          }
        }
      `);
      var payload = {
        '123': {
          __dataID__: '123',
          id: '123'
        },
        '456': {
          __dataID__: '456',
          id: '456'
        }
      };
      expect(() => {
        writePayload(store, query, payload);
      }).toFailInvariant(
        'writeRelayQueryPayload(): Expected payload to have at most 1 ' +
        'payload for root call `me()`, called with 2 payloads.'
      );
    });

    it('requires a single result for ref queries', () => {
      var records = {};
      var store = new RelayRecordStore({records});
      var query = getRefNode(Relay.QL`
        query {
          node(id:$ref_q0) {
            id
          }
        }
      `, {path: '$.*.id'}); // This path is bogus.
      var payload = {
        '123': {
          __dataID__: '123',
          id: '123'
        },
        '456': {
          __dataID__: '456',
          id: '456'
        }
      };
      expect(() => {
        writePayload(store, query, payload);
      }).toFailInvariant(
        'writeRelayQueryPayload(): Expected payload to have at most 1 ' +
        'payload for root call `node()`, called with 2 payloads.'
      );
    });

    it('is not created when the response is undefined', () => {
      var records = {};
      var store = new RelayRecordStore({records});
      var query = getNode(Relay.QL`
        query {
          node(id:"123") {
            id
          }
        }
      `);
      var payload = {
        '123': undefined
      };
      expect(() => {
        writePayload(store, query, payload);
      }).toFailInvariant(
        'RelayQueryWriter: Unexpectedly encountered `undefined` in payload. ' +
        'Cannot set root record `123` to undefined.'
      );
      expect(store.getRecordStatus('123')).toBe('UNKNOWN');
    });

    it('is not deleted when the response is undefined', () => {
      var records = {
        '123': {
          __dataID__: '123',
          id: '123'
        }
      };
      var store = new RelayRecordStore({records});
      var query = getNode(Relay.QL`
        query {
          node(id:"123") {
            actor {
              id
            }
          }
        }
      `);
      var payload = {
        '123': undefined
      };
      expect(() => {
        writePayload(store, query, payload);
      }).toFailInvariant(
        'RelayQueryWriter: Unexpectedly encountered `undefined` in payload. ' +
        'Cannot set root record `123` to undefined.'
      );
      expect(store.getRecordStatus('123')).toBe('EXISTENT');
    });

    it('is created when a new record returns a value', () => {
      var records = {};
      var store = new RelayRecordStore({records});
      var query = getNode(Relay.QL`
        query {
          node(id:"123") {
            id
          }
        }
      `);
      var payload = {
        '123': {
          id: '123'
        }
      };
      var results = writePayload(store, query, payload);
      expect(results).toEqual({
        created: {
          '123': true
        },
        updated: {}
      });
      expect(store.getRecordStatus('123')).toBe('EXISTENT');
    });

    it('is not updated if the record exists and has no changes', () => {
      var records = {
        '123': {
          __dataID__: '123',
          id: '123'
        }
      };
      var store = new RelayRecordStore({records});
      var query = getNode(Relay.QL`
        query {
          node(id:"123") {
            id
          }
        }
      `);
      var payload = {
        '123': {
          id: '123'
        }
      };
      var results = writePayload(store, query, payload);
      expect(results).toEqual({
        created: {},
        updated: {}
      });
      expect(store.getRecordStatus('123')).toBe('EXISTENT');
    });

    it('is updated if the record has changes', () => {
      var records = {
        '123': {
          __dataID__: '123',
          id: '123',
          name: 'Joe'
        }
      };
      var store = new RelayRecordStore({records});
      var query = getNode(Relay.QL`
        query {
          node(id:"123") {
            id,
            name
          }
        }
      `);
      var payload = {
        '123': {
          id: '123',
          name: 'Joseph'
        }
      };
      var results = writePayload(store, query, payload);
      expect(results).toEqual({
        created: {},
        updated: {
          '123': true
        }
      });
      expect(store.getRecordStatus('123')).toBe('EXISTENT');
      expect(store.getField('123', 'name')).toBe('Joseph');
    });

    it('is not affected by non-requested fields', () => {
      var records = {
        '123': {
          __dataID__: '123',
          id: '123'
        }
      };
      var store = new RelayRecordStore({records});
      var query = getNode(Relay.QL`
        query {
          node(id:"123") {
            id,
          }
        }
      `);
      var payload = {
        '123': {
          id: '123',
          name: 'Joseph'
        }
      };
      var results = writePayload(store, query, payload);
      expect(results).toEqual({
        created: {},
        updated: {}
      });
      expect(store.getRecordStatus('123')).toBe('EXISTENT');
      expect(store.getField('123', 'name')).toBe(undefined);
    });
  });
});
