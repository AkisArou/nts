// `querystring`'s seven names, and the aliasing no name check can see.
//
// The module compiles and publishes **zero of nine**. Its wrapper diagnostics
// split 1 / 7 / 1: one name the backend cannot name, seven functions that were
// never compiled. So unlike `assert` or `string_decoder`, this module is mostly
// waiting on *refusals* rather than on a class export -- `decodeURIComponent`
// (a missing builtin), a computed member read, and the `determineSpecificType`
// queue.
//
// Node's answers come from a child `node -p`: inside this harness
// `require("node:querystring")` and `require("querystring")` are the same
// object.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const querystring = require("querystring");

function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const expected = fromRealNode('Object.keys(require("node:querystring")).sort()');
const nodeTypes = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:querystring"))' +
    '.map((k) => [k, typeof require("node:querystring")[k]]))',
);

assert.ok(
  expected.length >= 7,
  `node's querystring exports ${expected.length} names, too few to be real`,
);

const actual = new Set(Object.keys(querystring));
const missing = expected.filter((name) => !actual.has(name));
assert.deepStrictEqual(missing, [], `missing name(s) node has: ${missing.join(", ")}`);

for (const name of expected) {
  assert.strictEqual(
    typeof querystring[name],
    nodeTypes[name],
    `querystring.${name} is ${typeof querystring[name]}, node's is ${nodeTypes[name]}`,
  );
}

const extra = [...actual].filter((name) => !expected.includes(name)).sort();
assert.deepStrictEqual(extra, [], `publishes name(s) node does not: ${extra.join(", ")}`);

// **`decode` and `parse` are the same function, and so are `encode` and
// `stringify`.** Node aliases them, and a surface that published four distinct
// implementations would satisfy every check above while doubling the code any
// fix has to keep in step. Reference equality is the only way to see it.
assert.strictEqual(querystring.decode, querystring.parse, "decode is not parse");
assert.strictEqual(querystring.encode, querystring.stringify, "encode is not stringify");

// And a round trip, so a surface of correctly-typed names that does nothing
// cannot pass. The `+` is the one that separates `querystring` from `URLSearchParams`:
// both decode it as a space, and only one of them encodes a space as `%20`.
assert.strictEqual(querystring.stringify({ a: "b c", d: "e&f" }), "a=b%20c&d=e%26f");
const parsed = querystring.parse("a=b+c&d=e%26f");
assert.strictEqual(parsed.a, "b c");
assert.strictEqual(parsed.d, "e&f");

// `unescapeBuffer` is the one name that is not part of the documented four, and
// it takes and returns bytes rather than a string.
assert.strictEqual(typeof querystring.unescapeBuffer, "function");
