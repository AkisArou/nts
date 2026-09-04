'use strict';
// Applicable behavior isolated from pinned upstream
// test-event-emitter-no-error-provided-to-error-event.js and
// test-events-uncaught-exception-stack.js. Those files require host domain or
// process uncaught-exception integration after the error escapes.
const assert = require('assert');
const EventEmitter = require('events');

const empty = new EventEmitter();
assert.throws(
  () => empty.emit('error'),
  (error) => {
    assert.strictEqual(error.code, 'ERR_UNHANDLED_ERROR');
    assert.strictEqual(error.message, 'Unhandled error.');
    assert.ok(error instanceof Error);
    return true;
  },
);

const carried = new Error('carried');
assert.throws(
  () => new EventEmitter().emit('error', carried),
  (error) => {
    assert.strictEqual(error, carried);
    assert.ok(error.stack.startsWith('Error: carried'));
    return true;
  },
);
