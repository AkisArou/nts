// `getTimerDuration`, against node's, including which error it raises.
//
// The compiled `timers` publishes three names and **none is on node's public
// surface** -- they are `internal/timers` helpers, which is where node's own
// `lib/` reaches them. The module records zero compiled passes: every upstream
// `test-timers-*.js` arms the loop, and the two local files here are guards on
// things that do not exist yet.
//
// `getTimerDuration` needs no loop. It validates a delay and returns it, and it
// is the function every `setTimeout` in node goes through first.
//
// # The cases, and which of them separate implementations
//
//     1, 0, 1.5          returned unchanged -- 0 is valid and 1.5 is not rounded
//     2147483647         the largest that fits
//     2147483648         clamped to 2147483647, with a TimeoutOverflowWarning

// The rejected cases are `duration-errors-static.js`, and they are split out
// because they fail on the compiled lane for a reason that has nothing to do
// with this function: the error reaches the host with `code` undefined.
//
// Checked against `node --expose-internals -p "require('internal/timers')"` on
// 24.20.0 before this was written: **twelve cases, none differing, error codes
// included.**
//
// `1.5` is the row worth naming: node does not round it, and an implementation
// that coerces to an integer passes every other line here.
//
// # The overflow warning is expected, not incidental
//
// `2147483648` makes node emit `TimeoutOverflowWarning`. The handler below
// accepts that one and rethrows anything else, so the file does not pass by
// swallowing a warning it did not expect.
"use strict";

require("../common");

const assert = require("assert");
const { getTimerDuration, TIMEOUT_MAX } = require("internal/timers");

process.on("warning", (w) => {
  if (w.name !== "TimeoutOverflowWarning") throw w;
});

assert.strictEqual(typeof getTimerDuration, "function", "getTimerDuration is missing");
assert.strictEqual(TIMEOUT_MAX, 2147483647, "TIMEOUT_MAX is not node's");

// Accepted, and returned unchanged.
assert.strictEqual(getTimerDuration(1, "delay"), 1, "1 did not come back");
assert.strictEqual(getTimerDuration(0, "delay"), 0, "0 is valid and did not come back");
assert.strictEqual(getTimerDuration(1.5, "delay"), 1.5, "1.5 was rounded");
assert.strictEqual(
  getTimerDuration(TIMEOUT_MAX, "delay"),
  TIMEOUT_MAX,
  "the largest fitting value did not come back",
);

// Clamped rather than rejected, which is the case the warning exists for.
assert.strictEqual(
  getTimerDuration(TIMEOUT_MAX + 1, "delay"),
  TIMEOUT_MAX,
  "a value past the 32-bit limit was not clamped",
);
