'use strict';
// Applicable behavior isolated from pinned upstream
// test-event-emitter-add-listeners.js, whose first assertion requires
// prototype-alias function identity.
const common = require('../common');
const assert = require('assert');
const EventEmitter = require('events');

const emitter = new EventEmitter();
const names = [];
const listeners = [];

emitter.on('newListener', (name, listener) => {
  if (name !== 'newListener') {
    names.push(name);
    listeners.push(listener);
  }
});

const hello = common.mustCall((a, b) => {
  assert.strictEqual(a, 'a');
  assert.strictEqual(b, 'b');
});

emitter.once('newListener', common.mustCall(function(name, listener) {
  assert.strictEqual(name, 'hello');
  assert.strictEqual(listener, hello);
  assert.deepStrictEqual(this.listeners('hello'), []);
}));
emitter.on('hello', hello);

assert.deepStrictEqual(names, ['hello']);
assert.deepStrictEqual(listeners, [hello]);
assert.strictEqual(emitter.emit('hello', 'a', 'b'), true);
