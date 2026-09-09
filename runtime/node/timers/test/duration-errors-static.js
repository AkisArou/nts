// Which error `getTimerDuration` raises, which is a different question from
// whether it raises one.
//
// Node distinguishes two kinds of bad delay and this file asserts the
// distinction:
//
//     -5, NaN, Infinity   ERR_OUT_OF_RANGE      a number node will not accept
//     "3", true           ERR_INVALID_ARG_TYPE  not a number at all
//     undefined, null     ERR_INVALID_ARG_TYPE
//
// A numeric string is in the second group and not the first. An implementation
// that validates with one check raises one code for everything and passes any
// test asserting only "it throws".
//
// # It fails on the compiled lane, and not for a reason about timers
//
// The error reaches the host with **`code` undefined and `name` carrying the
// code**:
//
//     node   name RangeError          code "ERR_OUT_OF_RANGE"
//     ours   name ERR_OUT_OF_RANGE     code undefined
//
// `internal/errors.ts:409` declares `override readonly code = "ERR_OUT_OF_RANGE"`
// -- a **class field** -- and `:406` overrides the `constructor` getter to
// report as `RangeError`, which is node's own device. Neither a field nor an
// accessor crosses the wrapper, so the code is lost and the class name leaks
// into `name`.
//
// That is `blockers/class-fields-do-not-cross`, and this file is what it costs
// where it is easiest to see. **792 of node's `parallel` tests assert
// `code: 'ERR_...'`** -- 91 in `fs` alone, 49 in `stream`, 41 in `http`. Most of
// them fail earlier than this today, so that number is the wall behind the
// current one rather than a count of what this blocks now.
//
// # Why it is a separate file
//
// `duration-static.js` next door asserts the accepted values and the 32-bit
// clamp and passes on both lanes. Keeping the two halves together would have
// made the whole thing fail compiled for a reason that is not about
// `getTimerDuration` at all, and `timers` would have shown zero rather than the
// one thing it demonstrably does.
"use strict";

require("../common");

const assert = require("assert");
const { getTimerDuration } = require("internal/timers");

assert.strictEqual(typeof getTimerDuration, "function", "getTimerDuration is missing");

// Out of range: a number node will not accept.
for (const bad of [-5, NaN, Infinity]) {
  assert.throws(
    () => getTimerDuration(bad, "delay"),
    { code: "ERR_OUT_OF_RANGE" },
    `${String(bad)} did not raise ERR_OUT_OF_RANGE`,
  );
}

// Wrong type: not a number at all. A numeric string belongs here, not above.
for (const bad of ["3", true, undefined, null]) {
  assert.throws(
    () => getTimerDuration(bad, "delay"),
    { code: "ERR_INVALID_ARG_TYPE" },
    `${JSON.stringify(bad) ?? "undefined"} did not raise ERR_INVALID_ARG_TYPE`,
  );
}
