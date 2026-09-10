"use strict";

// `new Socket({ fd })` validates the descriptor before any syscall sees it.
//
// It did not, and the difference was a *kind* of failure rather than a message:
//
//     new Socket({ fd: "x" })
//       node  TypeError  ERR_INVALID_ARG_TYPE
//       ours  Error      EPERM
//
// The value went straight to the adopt call and failed as a permissions error on
// whatever it coerced to. An invalid argument reported as a system error names
// the wrong cause, and a caller checking `err.code === "ERR_INVALID_ARG_TYPE"`
// -- which is how node's own suite states this -- would not have matched.
//
// All three of node's messages are asserted, not just the first, because the
// bounds are as much a part of `validateInt32` as the type check: a fix that
// only rejected non-numbers would pass a one-case test and still take -1.

require("../common");
const assert = require("assert");
const net = require("net");

for (const value of ["x", null, true, {}, []]) {
  assert.throws(
    () => new net.Socket({ fd: value }),
    { code: "ERR_INVALID_ARG_TYPE", name: "TypeError" },
    `fd: ${JSON.stringify(value)} must be a type error`,
  );
}

assert.throws(() => new net.Socket({ fd: -1 }), {
  code: "ERR_OUT_OF_RANGE",
  message: /must be >= 0 && <= 2147483647/,
});
assert.throws(() => new net.Socket({ fd: 1.5 }), {
  code: "ERR_OUT_OF_RANGE",
  message: /must be an integer/,
});

// The exact wording, since node's tests match on it.
assert.throws(() => new net.Socket({ fd: "x" }), {
  message: 'The "fd" argument must be of type number. Received type string (\'x\')',
});
