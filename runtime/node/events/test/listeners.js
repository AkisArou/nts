'use strict';
// Applicable behavior isolated from pinned upstream
// test-event-emitter-listeners.js, which inspects .listener metadata attached
// to Node's once wrapper function.
const assert = require('assert');
const {
  EventEmitter,
  getEventListeners,
} = require('events');

function persistent() {}
function once() {}

const emitter = new EventEmitter();
assert.deepStrictEqual(getEventListeners(emitter, 'value'), []);
emitter.on('value', persistent);
emitter.once('value', once);

assert.deepStrictEqual(emitter.listeners('value'), [persistent, once]);
assert.deepStrictEqual(getEventListeners(emitter, 'value'), [persistent, once]);
const publicCopy = emitter.listeners('value');
publicCopy.pop();
assert.deepStrictEqual(emitter.listeners('value'), [persistent, once]);

const helperCopy = getEventListeners(emitter, 'value');
helperCopy.pop();
assert.deepStrictEqual(getEventListeners(emitter, 'value'), [persistent, once]);

const raw = emitter.rawListeners('value');
assert.strictEqual(raw[0], persistent);
assert.notStrictEqual(raw[1], once);
raw[1]();
assert.deepStrictEqual(emitter.listeners('value'), [persistent]);
