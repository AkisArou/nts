"use strict";

// `util.promisify` on a timer must reach the `timers/promises` form.
//
// Node says so with a symbol-keyed link on the function object itself:
//
//     timers.setTimeout[promisify.custom]   === timers/promises.setTimeout
//     timers.setImmediate[promisify.custom] === timers/promises.setImmediate
//
// Nothing upstream asserts the link, because on node it cannot be missing --
// `lib/timers.js` sets it beside the definition. Here the two halves are a
// compiled module and a host shim, so it can be, and was.
//
// Without it `promisify` builds its generic wrapper, which appends a node-style
// `(err, value)` callback. `setTimeout(after, value)` takes the value to resolve
// with as its *first* argument, so the wrapper hands a number where a callback is
// validated and the call throws ERR_INVALID_ARG_TYPE -- it does not merely
// resolve with the wrong thing.

require("../common");
const assert = require("assert");
const timers = require("timers");
const timersPromises = require("timers/promises");
const { promisify } = require("util");

const custom = Symbol.for("nodejs.util.promisify.custom");

assert.strictEqual(timers.setTimeout[custom], timersPromises.setTimeout);
assert.strictEqual(timers.setImmediate[custom], timersPromises.setImmediate);

// The link is only worth having for what it makes `promisify` do.
promisify(timers.setTimeout)(1, "the-value").then((value) => {
  assert.strictEqual(value, "the-value");
});
promisify(timers.setImmediate)("immediate-value").then((value) => {
  assert.strictEqual(value, "immediate-value");
});
