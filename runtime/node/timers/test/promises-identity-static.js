// `require('timers/promises')` is `timers.promises`, with both sides required
// to carry something first.
//
// `test-timers-promises.js` is one `deepStrictEqual` between the two. Under
// `--empty-exports` `shape.mjs` takes its `exports.promises === undefined`
// branch and returns `{}`, the subpath is `{}` as well, `deepStrictEqual({}, {})`
// holds, and the file passes with no module. It was one of five hollow passes
// on the compiled axis.
//
// `deepStrictEqual` is what makes it hollow rather than merely weak: two empty
// objects are deeply equal, so the assertion is strongest exactly when there is
// nothing to compare.
//
// The upstream comparison is kept, behind a check that the namespace has the
// three functions node puts there and that one of them actually returns a
// promise.
//
// # This file fails today, and that is the point
//
// `timers.promises` is `undefined` in the ordinary run, not only under a
// control, so both sides of the upstream `deepStrictEqual` are absent and it
// passes. There is no passing replacement to write: this one fails with
// `Cannot read properties of undefined (reading 'setTimeout')` until the
// namespace exists, and passes when it does.
"use strict";

const common = require("../common");

const assert = require("assert");
const timers = require("node:timers");
const timerPromises = require("node:timers/promises");

// An absent module fails here, and so does `{}`.
for (const name of ["setTimeout", "setImmediate", "setInterval"]) {
  assert.strictEqual(
    typeof timerPromises[name],
    "function",
    `timers/promises.${name} is not a function`,
  );
  assert.strictEqual(
    typeof timers.promises[name],
    "function",
    `timers.promises.${name} is not a function`,
  );
}

// And a namespace of stubs fails here.
const pending = timerPromises.setTimeout(1, "value");
assert.strictEqual(typeof pending.then, "function", "setTimeout did not return a thenable");

// The upstream assertion.
assert.deepStrictEqual(timerPromises, timers.promises);

// The timer has to actually fire and carry its value. `mustCall` is how this
// suite keeps an unresolved promise from passing as a silent success.
pending.then(
  common.mustCall((v) => {
    assert.strictEqual(v, "value", "the promise did not resolve with its value");
  }),
  common.mustNotCall(),
);
