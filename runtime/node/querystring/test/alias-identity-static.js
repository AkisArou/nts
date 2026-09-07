// `decode` is `parse`, and `encode` is `stringify` — the same function object,
// not an equivalent one.
//
// Node builds them that way (`lib/querystring.js:54,57`: `encode: stringify`,
// `decode: parse`), and **no upstream test asserts it**. Searched all of
// `parallel/test-querystring*.js`: nothing compares the two. On node it could
// not be otherwise — an object literal cannot give one key a copy of another's
// value — so there was never an invariant there to test.
//
// It matters here because this profile compiles, and an alias is precisely what
// the Node-API backend reports it cannot name: `emit-c` says "refused by
// nothing" for `decode` and `encode`, and the tempting repair is the one that
// was just applied to `os`, where four exports were aliases of their binding and
// became functions:
//
//     export function decode(...) { return parse(...); }    // WRONG here
//
// That publishes the name and silently destroys the identity. It is the right
// repair for `os`, because `os.freemem` is its own function on node and the
// alias was *hiding* the binding's name; it is the wrong repair here, because
// the sameness is what node actually has. The two cases look identical in the
// compiler's output and are opposites in the source, so this file exists to make
// the wrong one fail loudly rather than pass quietly.
"use strict";

require("../common");

const assert = require("assert");
const querystring = require("querystring");

// The identity itself, in both directions, so a break is not mistaken for a
// missing export.
assert.strictEqual(typeof querystring.parse, "function", "parse is missing");
assert.strictEqual(typeof querystring.stringify, "function", "stringify is missing");
assert.strictEqual(
  querystring.decode,
  querystring.parse,
  "querystring.decode is no longer the same function object as querystring.parse",
);
assert.strictEqual(
  querystring.encode,
  querystring.stringify,
  "querystring.encode is no longer the same function object as querystring.stringify",
);

// Not on `QueryString`: node has no such export (`Object.keys` gives exactly
// decode, encode, escape, parse, stringify, unescape, unescapeBuffer), and this
// profile's `QueryString` is the object `shape.mjs` consumes to build that
// surface rather than part of it. Asserting on it here would have been testing
// the harness.

// Sameness is not enough on its own: two aliases of a *broken* parse would also
// compare equal. Check the thing they alias still works, so this file cannot
// pass by both names being equally wrong.
assert.deepStrictEqual(
  { ...querystring.decode("a=1&b=2") },
  { a: "1", b: "2" },
  "the aliased parse does not parse",
);
assert.strictEqual(
  querystring.encode({ a: "1", b: "2" }),
  "a=1&b=2",
  "the aliased stringify does not stringify",
);
