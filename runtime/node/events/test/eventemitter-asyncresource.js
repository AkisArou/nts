'use strict';
// Applicable public behavior isolated from pinned upstream
// test-eventemitter-asyncresource.js, whose default subclass-name and
// prototype brand-check cases require observable constructor metadata and
// prototype reflection.
const common = require('../common');
const assert = require('assert');
const {
  EventEmitterAsyncResource,
} = require('events');
const {
  createHook,
  executionAsyncId,
} = require('async_hooks');

const events = [];
let resourceFromInit;
const originalExecutionAsyncId = executionAsyncId();
const hook = createHook({
  init(asyncId, type, triggerAsyncId, resource) {
    if (type !== 'ResourceName') return;
    resourceFromInit = resource;
    events.push(['init', asyncId, triggerAsyncId]);
  },
  before(asyncId) {
    if (asyncId === emitter.asyncId) events.push(['before', asyncId]);
  },
  after(asyncId) {
    if (asyncId === emitter.asyncId) events.push(['after', asyncId]);
  },
  destroy(asyncId) {
    if (asyncId === emitter.asyncId) events.push(['destroy', asyncId]);
  },
}).enable();

const emitter = new EventEmitterAsyncResource({
  name: 'ResourceName',
  requireManualDestroy: true,
});
assert.strictEqual(emitter.triggerAsyncId, originalExecutionAsyncId);
assert.strictEqual(resourceFromInit, emitter.asyncResource);
assert.strictEqual(emitter.asyncResource.eventEmitter, emitter);

emitter.on('work', common.mustCall(function(value) {
  assert.strictEqual(this, emitter);
  assert.strictEqual(value, 42);
  assert.strictEqual(executionAsyncId(), emitter.asyncId);
}));
assert.strictEqual(emitter.emit('work', 42), true);
assert.strictEqual(emitter.emitDestroy(), emitter);

setImmediate(common.mustCall(() => {
  hook.disable();
  assert.deepStrictEqual(events, [
    ['init', emitter.asyncId, originalExecutionAsyncId],
    ['before', emitter.asyncId],
    ['after', emitter.asyncId],
    ['destroy', emitter.asyncId],
  ]);

  const positional = new EventEmitterAsyncResource('PositionalName');
  assert.strictEqual(positional.asyncResource.eventEmitter, positional);
}));
