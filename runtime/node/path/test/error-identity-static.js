// The error identity `parallel/test-path.js` does not check.
//
// Upstream asserts every one of its type errors as
// `{ code: 'ERR_INVALID_ARG_TYPE', name: 'TypeError' }` — two own properties.
// A plain `Error` with those two fields assigned satisfies it. Nothing upstream
// asks whether the thrown value is a TypeError, and on node it could not be
// otherwise, so there was never a reason to.
//
// This profile compiles, and there the class an object is laid out as decides
// what `instanceof` accepts. `ERR_INVALID_ARG_TYPE` is the most-thrown error in
// the whole profile — `validateString` is upstream of eleven of `path`'s
// exports alone — so if any error's identity is worth pinning, it is this one.
//
// See `punycode/test/error-identity-static.js` for the same argument and the
// mutation that demonstrates it.
"use strict";

require("../common");

const assert = require("assert");
const path = require("path");

// Both namespaces, because they are separate implementations over shared
// helpers and an identity could hold in one and not the other.
for (const namespace of [path.posix, path.win32]) {
  for (const [name, args] of [
    ["resolve", [1]],
    ["join", [1]],
    ["basename", [1]],
    ["dirname", [1]],
    ["extname", [1]],
    ["normalize", [1]],
    ["isAbsolute", [1]],
  ]) {
    let thrown;
    try {
      namespace[name](...args);
    } catch (error) {
      thrown = error;
    }

    assert.notStrictEqual(thrown, undefined, `${name} did not throw`);
    // The two upstream checks, kept so this file is a superset rather than a
    // different test: a regression in either would fail here too.
    assert.strictEqual(thrown.code, "ERR_INVALID_ARG_TYPE", `${name}: wrong code`);
    assert.strictEqual(thrown.name, "TypeError", `${name}: wrong name`);

    // The part upstream leaves free.
    assert.ok(thrown instanceof TypeError, `${name} threw a non-TypeError named TypeError`);
    // Separately, because a hierarchy breaks at either link.
    assert.ok(thrown instanceof Error, `${name} threw a TypeError that is not an Error`);
  }
}
