'use strict';

// That a timer waits, which node's own suite very nearly does not check.
//
// Collapsing every requested delay to 1ms -- a `setTimeout(f, 1500)` firing
// after 2ms -- leaves 50 of node's 53 applicable `timers` files passing. That
// is a fact about the available oracle rather than about this implementation:
// node's timer tests are about semantics (ordering, ref and unref, clearing,
// argument validation) because a test that asserts elapsed wall-clock time is
// flaky by construction, so upstream mostly declines to write one.
//
// Declining leaves the one property timers exist for unmeasured. This file
// measures it, and it is written to be robust rather than tight: a timer may
// always fire *late*, so every assertion here is a floor, and the margins are
// wide enough that a loaded machine does not fail it. It still fails
// immediately under the mutation above, which is the only thing it is for.

const assert = require('assert');
const { setTimeout: setTimeoutCb } = require('timers');

const started = Date.now();
const order = [];

// Ordering across different delays. A collapsed delay reverses or scrambles
// this, since every timer becomes due at once and only insertion order remains.
setTimeoutCb(() => order.push('third'), 90);
setTimeoutCb(() => order.push('first'), 10);
setTimeoutCb(() => order.push('second'), 50);

setTimeoutCb(() => {
  assert.deepStrictEqual(
    order,
    ['first', 'second', 'third'],
    'timers must run in order of their delay, not of their creation',
  );

  // The floor: 120ms of timers cannot have completed in a handful of
  // milliseconds. Deliberately far below 120 so that timer coalescing and a
  // slow machine cannot make this fail, and far above the ~2ms a collapsed
  // delay produces.
  const elapsed = Date.now() - started;
  assert.ok(
    elapsed >= 60,
    `a 120ms timer chain finished in ${elapsed}ms, so the delay was not honoured`,
  );
}, 120);
