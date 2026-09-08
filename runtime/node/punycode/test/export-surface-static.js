// The whole of `punycode`'s public surface, asserted rather than assumed.
//
// This module is the only one green on the compiled axis, and it was recorded
// for a long time as "green and incomplete -- `version` absent". Measured on
// 2026-09-08 that is no longer true: the addon publishes all six names node
// does, `version` reads `"2.1.0"` exactly as node's does, and `ucs2` carries
// both members. Nothing asserted any of it.
//
// Node ships **two** test files for this module, and neither reads `version` or
// enumerates the surface -- upstream `punycode` is a vendored userland library
// whose exports cannot go missing, so there was no failure for a test to catch.
// That is the gap this file is for: a compiled artifact *can* lose an export,
// silently, and did for as long as the ledger said it had.
//
// The value of `version` is pinned deliberately. It is a string constant, and a
// string constant is exactly the kind of export the backend was dropping until
// this morning -- a numeric literal const was folded into its readers and left
// nothing for the export table to name. Strings were unaffected, which is why
// this one survived, and asserting it means a future change to how constants
// are published cannot quietly take it away again.

"use strict";
const assert = require("assert");
const punycode = require("punycode");

// The six, by name. `deepStrictEqual` on the sorted list rather than six
// `assert.ok(k in punycode)` calls: this has to fail when something is *added*
// as well, because an export node does not have is a divergence in the same way
// a missing one is.
assert.deepStrictEqual(
  Object.keys(punycode).sort(),
  ["decode", "encode", "toASCII", "toUnicode", "ucs2", "version"],
);

for (const name of ["decode", "encode", "toASCII", "toUnicode"]) {
  assert.strictEqual(
    typeof punycode[name],
    "function",
    `punycode.${name} should be a function`,
  );
}

// A string, and this exact string. Node vendors punycode.js 2.1.0 and reports
// it here; a compiled artifact that published `undefined`, or an empty string,
// or a number, would pass every other test in this module.
assert.strictEqual(typeof punycode.version, "string");
assert.strictEqual(punycode.version, "2.1.0");

// `ucs2` is an object with two functions, not a function and not a class. It is
// the only nested value on this surface, so it is the only place the backend has
// to publish something that is neither a function nor a scalar.
assert.strictEqual(typeof punycode.ucs2, "object");
assert.notStrictEqual(punycode.ucs2, null);
assert.deepStrictEqual(Object.keys(punycode.ucs2).sort(), ["decode", "encode"]);
assert.strictEqual(typeof punycode.ucs2.decode, "function");
assert.strictEqual(typeof punycode.ucs2.encode, "function");

// And that the members are wired to the right implementations, since two
// functions of the right type in the right places is not the same as two
// correct ones. A round trip through both, on a string that needs surrogate
// pairs, so `ucs2.decode` cannot be `[...s].map(c => c.charCodeAt(0))`.
const points = punycode.ucs2.decode("a\u{1F600}b");
assert.deepStrictEqual(points, [0x61, 0x1f600, 0x62]);
assert.strictEqual(punycode.ucs2.encode(points), "a\u{1F600}b");
