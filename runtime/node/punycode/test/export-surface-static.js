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

const findings = [];
for (const name of ["decode", "encode", "toASCII", "toUnicode"]) {
  if (typeof punycode[name] !== "function") {
    findings.push(`punycode.${name} is ${typeof punycode[name]}, node's is a function`);
  }
}

// **And that each of the four can be called**, which `typeof` does not say.
//
// Node has no reason to assert this: there, a name of type `function` is always
// callable. Here it is not -- `buffer.isUtf8` publishes with the right type and
// throws for every argument node accepts, because its parameter has no inbound
// representation. `ucs2.decode` and `ucs2.encode` below were already exercised
// by a round trip; these four were asserted to be functions and never called.
//
// The values are node's, taken from `node:punycode` directly, and the pair
// `mañana`/`maana-pta` is the RFC 3492 example so a wrong implementation cannot
// agree by accident.
for (const [label, got, want] of [
  ["encode(\"mañana\")", typeof punycode.encode === "function" ? punycode.encode("mañana") : undefined, "maana-pta"],
  ["encode(\"日本\")", typeof punycode.encode === "function" ? punycode.encode("日本") : undefined, "wgv71a"],
  ["decode(\"maana-pta\")", typeof punycode.decode === "function" ? punycode.decode("maana-pta") : undefined, "mañana"],
  ["toASCII(\"mañana.com\")", typeof punycode.toASCII === "function" ? punycode.toASCII("mañana.com") : undefined, "xn--maana-pta.com"],
  ["toUnicode(\"xn--maana-pta.com\")", typeof punycode.toUnicode === "function" ? punycode.toUnicode("xn--maana-pta.com") : undefined, "mañana.com"],
]) {
  let answer;
  try { answer = got; } catch (error) { findings.push(`${label} threw: ${error.message}`); continue; }
  if (answer !== want) findings.push(`${label} is ${JSON.stringify(answer)}, node's is ${JSON.stringify(want)}`);
}

assert.deepStrictEqual(
  findings,
  [],
  `${findings.length} surface finding(s):\n  ${findings.join("\n  ")}`,
);

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
