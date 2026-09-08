// Every name node's `zlib` has, and the constants table behind them.
//
// `zlib` has two local tests, the fewest of any module in the profile, and it
// is one of the twelve that a single compiler fix is expected to move from
// "does not compile" to "compiles". When that happens the interesting question
// is not whether its tests pass -- it is whether the addon published enough for
// them to mean anything. `buffer` compiles today and publishes 3 of its 15
// exports; its 55 failures read as fifty-five broken assertions and are one
// fact.
//
// So this is written now, before the module compiles, to be waiting when it
// does.
//
// Node's names come from a **subprocess**, and that detail is the whole test.
//
// The obvious spelling is `require("node:zlib")` for node's and `require("zlib")`
// for ours. It does not work here: the harness substitutes the module under test
// for *both* specifiers, so the two are the same object --
//
//     same=true  ourKeys=47  nodeKeys=47  sameFn=true
//
// -- and every comparison below would be an object against itself, passing
// whatever the module did. `events/test/prototype-surface-static.js` was written
// that way and was hollow for exactly this reason; its comment said it "tracks
// the running node" and it was reading ours.
//
// A child `node -p` has no harness hooks in it, so what it prints is node's.
//
// **Missing-only, deliberately**, following `events/test/prototype-surface-static.js`.
// An equality assertion would pin node's internals -- names beginning `_` and
// anything added in a later node -- and fail for reasons that are not about this
// profile. A name we publish that node does not is a real divergence and belongs
// in the export diff, which `audit.mjs --exports` already does from the other
// side.

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
