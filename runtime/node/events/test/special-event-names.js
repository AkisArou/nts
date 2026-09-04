'use strict';
// Applicable behavior isolated from pinned upstream
// test-event-emitter-special-event-names.js, which first asserts that _events
// itself is a null-prototype object.
const common = require('../common');
const assert = require('assert');
const EventEmitter = require('events');

const emitter = new EventEmitter();
const quiet = () => {};
emitter.on('__proto__', quiet);
emitter.on('__defineGetter__', quiet);
emitter.on('toString', quiet);

assert.deepStrictEqual(
  emitter.eventNames(),
  ['__proto__', '__defineGetter__', 'toString'],
);
assert.deepStrictEqual(emitter.listeners('__proto__'), [quiet]);
assert.deepStrictEqual(emitter.listeners('__defineGetter__'), [quiet]);
assert.deepStrictEqual(emitter.listeners('toString'), [quiet]);

emitter.on('__proto__', common.mustCall((value) => {
  assert.strictEqual(value, 1);
}));
assert.strictEqual(emitter.emit('__proto__', 1), true);
