// Source: pinned Node v26.13.0 lib/zlib.js module.exports and the
// DefineZlibConstants table in src/node_zlib.cc. A clean subprocess observes
// upstream independently of the harness's substituted require. Missing ZIP
// exports must remain visible until that second pilot part is implemented.
// Check names, types, constants and one compression round trip; an empty
// expected surface must never make this test pass without measuring anything.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const zlib = require("zlib");

/** What a clean node says about its own module, with no harness in the way. */
function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const expected = fromRealNode('Object.keys(require("node:zlib")).sort()');
const nodeTypes = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:zlib")).map((k) => [k, typeof require("node:zlib")[k]]))',
);
// Values as *strings*, because JSON cannot carry the ones that matter here.
// `JSON.stringify(Infinity)` is `null`, and `zlib.constants.Z_MAX_CHUNK` is
// `Infinity` on both sides -- so the first version of this reported
// `Z_MAX_CHUNK is Infinity, node's is null` and I nearly recorded a divergence
// that was my own transport. `String(v)` round-trips every value in this table
// and is exact for the integers, which is all of the rest of it.
const nodeConstants = fromRealNode(
  'Object.fromEntries(Object.entries(require("node:zlib").constants).map(([k, v]) => [k, String(v)]))',
);
const actual = new Set(Object.keys(zlib));

// The floor. Without it, a `node:zlib` that failed to load leaves `expected`
// empty, every filter below returns nothing, and the file passes having checked
// nothing at all -- the failure that has bitten five instruments in this
// repository today, each by a different mechanism.
assert.ok(
  expected.length > 30,
  `node's zlib exports ${expected.length} names, which is too few to be real -- this checked nothing`,
);

const missing = expected.filter((name) => !actual.has(name));
assert.deepStrictEqual(missing, [], `zlib is missing name(s) node has: ${missing.join(", ")}`);

// Types, not just presence. An export table entry bound to `undefined` has the
// name and none of the meaning, which is exactly what a partially-published
// addon looks like from a test that only checks `in`.
for (const name of expected) {
  assert.strictEqual(
    typeof zlib[name],
    nodeTypes[name],
    `zlib.${name} is ${typeof zlib[name]}, node's is ${nodeTypes[name]}`,
  );
}

// `constants` is the one that cannot be checked by shape alone: it is an object
// of numbers, and a table published empty would satisfy every check above.
assert.strictEqual(typeof zlib.constants, "object");
assert.notStrictEqual(zlib.constants, null);
const constantNames = Object.keys(nodeConstants);
assert.ok(constantNames.length > 40, "node's zlib.constants looks empty");
const missingConstants = constantNames.filter((name) => !(name in zlib.constants));
assert.deepStrictEqual(
  missingConstants,
  [],
  `zlib.constants is missing ${missingConstants.length} name(s): ${missingConstants.slice(0, 6).join(", ")}`,
);
for (const name of constantNames) {
  assert.strictEqual(
    String(zlib.constants[name]),
    nodeConstants[name],
    `zlib.constants.${name} is ${zlib.constants[name]}, node's is ${nodeConstants[name]}`,
  );
}

// And one round trip, so a surface of correctly-typed names that does nothing
// cannot pass. Synchronous, because the async form is a separate contract and
// this file is about the surface.
const packed = zlib.deflateSync(Buffer.from("the quick brown fox"));
assert.ok(Buffer.isBuffer(packed), "deflateSync did not return a Buffer");
assert.strictEqual(zlib.inflateSync(packed).toString(), "the quick brown fox");
