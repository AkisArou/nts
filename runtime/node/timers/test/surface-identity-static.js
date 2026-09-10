"use strict";

// `clearTimeout` and `clearInterval` are two functions, not one under two names.
//
// The HTML standard gives them a single id space, so either cancels either, and
// node's own `clearInterval` is a one-line call to `clearTimeout` citing that
// paragraph. This module read the shared id space as a statement about identity
// and exported `clearTimeout as clearInterval`, with the reasoning written down:
// "so that they are indistinguishable including by identity". Node distinguishes
// them.
//
// Nothing upstream asserts it, because on node the two names cannot be the same
// object -- they are two declarations in `lib/timers.js` -- so there is nothing
// for node's suite to check.

require("../common");
const assert = require("assert");
const timers = require("timers");

assert.notStrictEqual(
  timers.clearInterval,
  timers.clearTimeout,
  "clearInterval and clearTimeout must be different function objects",
);
assert.strictEqual(timers.clearTimeout.name, "clearTimeout");
assert.strictEqual(timers.clearInterval.name, "clearInterval");
assert.strictEqual(timers.clearTimeout.length, 1);
assert.strictEqual(timers.clearInterval.length, 1);

// The identity above must not cost the shared id space, which is the part the
// standard actually requires: each clears the other's timer.
let fired = 0;
const timeout = timers.setTimeout(() => { fired |= 1; }, 5);
timers.clearInterval(timeout);
const interval = timers.setInterval(() => { fired |= 2; }, 5);
timers.clearTimeout(interval);

timers.setTimeout(() => {
  assert.strictEqual(
    fired,
    0,
    "clearInterval must cancel a setTimeout and clearTimeout a setInterval",
  );
}, 60);
