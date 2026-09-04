'use strict';
// Applicable behavior isolated from pinned upstream
// test-event-capture-rejections.js, which later grafts EventEmitter.prototype
// onto a function and constructs it without calling EventEmitter.
const common = require('../common');
const assert = require('assert');
const {
  EventEmitter,
  captureRejectionSymbol,
} = require('events');

assert.throws(
  () => new EventEmitter({ captureRejections: 1 }),
  { code: 'ERR_INVALID_ARG_TYPE' },
);

const ordinary = new EventEmitter({ captureRejections: true });
const ordinaryError = new Error('ordinary');
ordinary.on('error', common.mustCall((error) => {
  assert.strictEqual(error, ordinaryError);
}));
ordinary.on('work', async () => {
  throw ordinaryError;
});
ordinary.emit('work');

EventEmitter.captureRejections = true;
const configured = new EventEmitter();
EventEmitter.captureRejections = false;
const configuredError = new Error('configured');
configured[captureRejectionSymbol] = common.mustCall(function(error, type, value) {
  assert.strictEqual(this, configured);
  assert.strictEqual(error, configuredError);
  assert.strictEqual(type, 'work');
  assert.strictEqual(value, 42);
});
configured.on('work', async () => {
  throw configuredError;
});
configured.emit('work', 42);

const thenableEmitter = new EventEmitter({ captureRejections: true });
const thenableError = new Error('thenable');
thenableEmitter.on('error', common.mustCall((error) => {
  assert.strictEqual(error, thenableError);
}));
thenableEmitter.on('work', () => ({
  then(onFulfilled, onRejected) {
    assert.strictEqual(onFulfilled, undefined);
    onRejected(thenableError);
  },
}));
thenableEmitter.emit('work');

const throwingThenableEmitter = new EventEmitter({ captureRejections: true });
const throwingThenableError = new Error('throwing thenable');
throwingThenableEmitter.on('error', common.mustCall((error) => {
  assert.strictEqual(error, throwingThenableError);
}));
throwingThenableEmitter.on('work', () => ({
  then() {
    throw throwingThenableError;
  },
}));
throwingThenableEmitter.emit('work');
