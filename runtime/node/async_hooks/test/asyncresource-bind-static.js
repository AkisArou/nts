'use strict';

// Focused applicable coverage from Node v24.20.0
// test-asyncresource-bind.js. The omitted assertions read deprecated
// `fn.asyncResource` and observable `fn.length`, both §13 function-metadata
// non-goals.

const common = require('../common');
const assert = require('assert');
const { AsyncResource, executionAsyncId } = require('async_hooks');

const staticallyBound = common.mustCall(AsyncResource.bind(() => executionAsyncId()));
setImmediate(common.mustCall(() => {
  assert.notStrictEqual(executionAsyncId(), staticallyBound());
}));

const resource = new AsyncResource('test');
for (const value of [1, false, '', {}, []]) {
  assert.throws(() => resource.bind(value), { code: 'ERR_INVALID_ARG_TYPE' });
}

const bound = resource.bind(() => executionAsyncId());
setImmediate(common.mustCall(() => {
  const callerId = executionAsyncId();
  assert.strictEqual(resource.asyncId(), bound());
  assert.notStrictEqual(callerId, bound());
}));

const receiver = {};
resource.bind(common.mustCall(function() {
  assert.strictEqual(this, receiver);
}), receiver)();

resource.bind(common.mustCall(function() {
  assert.strictEqual(this, undefined);
}))();

resource.bind(common.mustCall(function() {
  assert.strictEqual(this, false);
}), false)();

resource.bind(common.mustCall(function() {
  assert.strictEqual(this, 'call-site receiver');
})).call('call-site receiver');
