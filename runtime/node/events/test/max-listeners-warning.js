'use strict';
// Applicable behavior isolated from pinned upstream
// test-event-emitter-max-listeners-warning.js, whose subclass-name assertion
// depends on observable constructor.name metadata.
const common = require('../common');
const assert = require('assert');
const EventEmitter = require('events');

const emitter = new EventEmitter();
const retained = () => {};
emitter.on('retained', retained);
emitter.setMaxListeners(1);
assert.deepStrictEqual(emitter.listeners('retained'), [retained]);
assert.strictEqual(emitter.getMaxListeners(), 1);
assert.throws(() => emitter.setMaxListeners(-1), {
  code: 'ERR_OUT_OF_RANGE',
});
assert.throws(() => emitter.setMaxListeners('one'), {
  code: 'ERR_INVALID_ARG_TYPE',
});
process.on('warning', common.mustCall((warning) => {
  assert.ok(warning instanceof Error);
  assert.strictEqual(warning.name, 'MaxListenersExceededWarning');
  assert.strictEqual(warning.emitter, emitter);
  assert.strictEqual(warning.count, 2);
  assert.strictEqual(warning.type, 'event-type');
  assert.ok(warning.message.includes(
    '2 event-type listeners added to [EventEmitter]. MaxListeners is 1.',
  ));
}));
emitter.on('event-type', () => {});
emitter.on('event-type', () => {});
// The warned state is typed state on the listener list, not array metadata.
// A third listener therefore remains quiet just as it does upstream.
emitter.on('event-type', () => {});
