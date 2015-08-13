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

describe('RelayContainer.hasFragmentData', function() {
  var GraphQLDeferredQueryTracker;
  var GraphQLStoreQueryResolver;
  var React;
  var Relay;
  var RelayPendingQueryTracker;

  var MockContainer;
  var mockRender;
  var mockPointer;

  beforeEach(function() {
    jest.resetModuleRegistry();

    GraphQLDeferredQueryTracker = require('GraphQLDeferredQueryTracker');
    GraphQLStoreQueryResolver = require('GraphQLStoreQueryResolver');
    React = require('React');
    Relay = require('Relay');
    RelayPendingQueryTracker = require('RelayPendingQueryTracker');

    var render = jest.genMockFunction().mockImplementation(() => <div />);
    var MockComponent = React.createClass({render});
    MockContainer = Relay.createContainer(MockComponent, {
      initialVariables: {site: 'mobile'},
      fragments: {
        foo: jest.genMockFunction().mockImplementation(
          variables => Relay.QL`fragment on Node{id,url(site:$site)}`
        ),
      },
    });
    MockContainer.mock = {render};

    var RelayTestRenderer = RelayTestUtils.createRenderer();
    GraphQLStoreQueryResolver.mockDefaultResolveImplementation((pointer) => {
      expect(pointer.getDataID()).toBe('42');
      return {__dataID__: '42', id: '42', url: null};
    });
    mockRender = () => {
      return RelayTestRenderer.render(genMockPointer => {
        return <MockContainer foo={genMockPointer('42')} />;
      });
    };
    mockPointer = {__dataID__: '42'};
  });

  it('has query data when no pending queries', () => {
    var instance = mockRender();
    spyOn(RelayPendingQueryTracker, 'hasPendingQueries').andReturn(false);

    expect(
      instance.hasFragmentData(MockContainer.getFragment('foo'), mockPointer)
    ).toBeTruthy();
  });

  it('has query data when no pending query matches', () => {
    var instance = mockRender();
    spyOn(RelayPendingQueryTracker, 'hasPendingQueries').andReturn(true);
    GraphQLDeferredQueryTracker.isQueryPending.mockReturnValue(false);

    expect(
      instance.hasFragmentData(MockContainer.getFragment('foo'), mockPointer)
    ).toBeTruthy();
  });

  it('does not have query data when a pending query matches', () => {
    var instance = mockRender();
    spyOn(RelayPendingQueryTracker, 'hasPendingQueries').andReturn(true);
    GraphQLDeferredQueryTracker.isQueryPending.mockReturnValue(true);

    expect(
      instance.hasFragmentData(MockContainer.getFragment('foo'), mockPointer)
    ).toBeFalsy();
  });

  it('does not have query data if a deferred query fails', () => {
    var instance = mockRender();
    var hasPendingQueriesSpy =
      spyOn(RelayPendingQueryTracker, 'hasPendingQueries');
    hasPendingQueriesSpy.andReturn(true);
    GraphQLDeferredQueryTracker.isQueryPending.mockReturnValue(true);

    // tell component to listen to query
    instance.hasFragmentData(MockContainer.getFragment('foo'), mockPointer);

    var fragmentName =
      GraphQLDeferredQueryTracker.addListenerForFragment.mock.calls[0][1];
    var {onFailure} =
      GraphQLDeferredQueryTracker.addListenerForFragment.mock.calls[0][2];

    var error = new Error();
    onFailure(mockPointer.__dataID__, fragmentName, error);
    hasPendingQueriesSpy.andReturn(true);
    GraphQLDeferredQueryTracker.isQueryPending.mockReturnValue(false);

    expect(
      instance.hasFragmentData(MockContainer.getFragment('foo'), mockPointer)
    ).toBeFalsy();
    expect(
      instance.getFragmentError(MockContainer.getFragment('foo'), mockPointer)
    ).toBe(error);
    expect(
      MockContainer.mock.render.mock.calls.length
    ).toBe(2);
  });
});
