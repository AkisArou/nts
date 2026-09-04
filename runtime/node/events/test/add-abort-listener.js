'use strict';
// Applicable public behavior isolated from pinned upstream
// test-events-add-abort-listener.mjs, whose stopImmediatePropagation case
// requires Node's private kResistStopPropagation listener flag.
const common = require('../common');
const assert = require('assert');
const {
  addAbortListener,
  getEventListeners,
} = require('events');

assert.throws(() => addAbortListener(), {
  code: 'ERR_INVALID_ARG_TYPE',
});
assert.throws(() => addAbortListener({}), {
  code: 'ERR_INVALID_ARG_TYPE',
});

const invalidListenerSignal = new AbortController().signal;
assert.throws(() => addAbortListener(invalidListenerSignal), {
  code: 'ERR_INVALID_ARG_TYPE',
});

const disposedController = new AbortController();
const disposed = addAbortListener(
  disposedController.signal,
  common.mustNotCall(),
);
assert.strictEqual(typeof disposed[Symbol.dispose], 'function');
assert.strictEqual(
  getEventListeners(disposedController.signal, 'abort').length,
  1,
);
disposed[Symbol.dispose]();
disposed[Symbol.dispose]();
assert.deepStrictEqual(
  getEventListeners(disposedController.signal, 'abort'),
  [],
);
disposedController.abort();

const ordinaryController = new AbortController();
addAbortListener(ordinaryController.signal, common.mustCall());
ordinaryController.abort();
assert.deepStrictEqual(
  getEventListeners(ordinaryController.signal, 'abort'),
  [],
);

let synchronous = true;
addAbortListener(AbortSignal.abort(), common.mustCall(() => {
  assert.strictEqual(synchronous, false);
}));
synchronous = false;
