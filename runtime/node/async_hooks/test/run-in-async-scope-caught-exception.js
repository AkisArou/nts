'use strict';

// Derived from Node v24.20.0
// `test/parallel/test-async-hooks-run-in-async-scope-caught-exception.js`.
// Node's file is a crash-only regression test, so an absent AsyncResource
// throws inside its catch and passes sabotage. These assertions make its
// supported contract observable: the error escapes unchanged, `after` runs,
// and the execution stack is restored after the catch.
const assert = require('assert');
const {
  AsyncResource,
  createHook,
  executionAsyncId,
} = require('async_hooks');

const rootId = executionAsyncId();
let beforeId;
let callbackId;
let afterId;

const hook = createHook({
  before(id) { beforeId = id; },
  after(id) { afterId = id; },
}).enable();
const resource = new AsyncResource('caught-exception-test');
const expected = new Error('bar');
let caught;

try {
  resource.runInAsyncScope(() => {
    callbackId = executionAsyncId();
    throw expected;
  });
} catch (error) {
  caught = error;
}
hook.disable();

assert.strictEqual(caught, expected);
assert.strictEqual(beforeId, resource.asyncId());
assert.strictEqual(callbackId, resource.asyncId());
assert.strictEqual(afterId, resource.asyncId());
assert.strictEqual(executionAsyncId(), rootId);
