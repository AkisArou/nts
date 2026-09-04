'use strict';
// Applicable behavior isolated from pinned upstream
// test-event-emitter-remove-listeners.js, which later inspects the internal
// listener property table with Reflect.ownKeys and _events.foo.
const common = require('../common');
const assert = require('assert');
const EventEmitter = require('events');

const emitter = new EventEmitter();
function first() {}
function second() {}

emitter.on('value', first);
emitter.on('value', second);
emitter.once('removeListener', common.mustCall((name, listener) => {
  assert.strictEqual(name, 'value');
  assert.strictEqual(listener, first);
  assert.deepStrictEqual(emitter.listeners('value'), [second]);
}));

const before = emitter.listeners('value');
emitter.removeListener('value', first);
assert.deepStrictEqual(before, [first, second]);
assert.deepStrictEqual(emitter.listeners('value'), [second]);
assert.deepStrictEqual(emitter.eventNames(), ['value']);

for (let i = 0; i < 100; i++) {
  const name = `event-${i}`;
  emitter.on(name, second);
  emitter.removeListener(name, second);
}
assert.deepStrictEqual(emitter.eventNames(), ['value']);
