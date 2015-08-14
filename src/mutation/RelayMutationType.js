/**
 * Copyright 2013-2015, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule RelayMutationType
 * @typechecks
 * @flow
 */

'use strict';

var RelayMutationType = {
  FIELDS_CHANGE: 'FIELDS_CHANGE',
  NODE_DELETE: 'NODE_DELETE',
  RANGE_ADD: 'RANGE_ADD',
  RANGE_DELETE: 'RANGE_DELETE',
  REQUIRED_CHILDREN: 'REQUIRED_CHILDREN'
};

module.exports = RelayMutationType;
