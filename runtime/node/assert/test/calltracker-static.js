'use strict';

// Supported behavior retained from:
//   test-assert-calltracker-calls.js
//   test-assert-calltracker-getCalls.js
//   test-assert-calltracker-report.js
//   test-assert-calltracker-verify.js
// The upstream files also require Proxy-transparent function metadata and
// frozen result objects, which are section-13 metaobject behavior.
const assert = require('assert');

const receiver = { value: 4 };
const tracker = new assert.CallTracker();
const tracked = tracker.calls(function add(left, right) {
  assert.strictEqual(this, receiver);
  return this.value + left + right;
}, 2);

assert.strictEqual(tracked.call(receiver, 2, 3), 9);
assert.strictEqual(tracked.call(receiver, 5, 6), 15);

const calls = tracker.getCalls(tracked);
assert.strictEqual(calls.length, 2);
assert.strictEqual(calls[0].thisArg, receiver);
assert.deepStrictEqual(calls[0].arguments, [2, 3]);
assert.deepStrictEqual(calls[1].arguments, [5, 6]);

// Returned records are independent snapshots even though they are not frozen.
calls[0].arguments[0] = 100;
assert.strictEqual(tracker.getCalls(tracked)[0].arguments[0], 2);
tracker.verify();

tracker.reset(tracked);
assert.strictEqual(tracker.getCalls(tracked).length, 0);
assert.strictEqual(tracker.report()[0].operator, 'calls');

tracked.call(receiver, 1, 1);
tracked.call(receiver, 1, 1);
tracker.verify();

const missing = new assert.CallTracker();
missing.calls(() => {}, 1);
assert.throws(() => missing.verify(), {
  code: 'ERR_ASSERTION',
  operator: undefined,
});

assert.throws(() => tracker.getCalls(() => {}), {
  code: 'ERR_INVALID_ARG_VALUE',
});
assert.throws(() => tracker.calls(() => {}, 0.5), {
  code: 'ERR_OUT_OF_RANGE',
});

