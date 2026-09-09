// Every name node's `buffer` has, with its type, and both directions.
//
// This module is the reason the other surface tests in this profile exist. It
// **compiles today** and publishes 3 of its 15 exports, and its 55 failures are
// that one fact: every test touching an absent name dies on a TypeError about
// `undefined`, which names nothing and reads as fifty-five behaviour bugs.
//
// The three it publishes are `kMaxLength`, `kStringMaxLength` and
// `INSPECT_MAX_BYTES` — two of which arrived only when a literal-initialised
// numeric export stopped being folded away with nothing left for the export
// table to name.
//
// Node's answers come from a child `node -p`. Inside this harness
// `require("node:buffer")` and `require("buffer")` are the **same object**, so
// an oracle taken that way compares a thing with itself.
//
// **Against the addon as it stands, this file does not run at all**: it fails
// with `loading the module: Cannot convert undefined or null to object`, because
// `shape.mjs` cannot build a surface from three exports. That is the module's
// state and not a defect in the test, but it is worth saying plainly -- a test
// cannot report what a module is missing if the module is missing too much to
// load. The count that works today is `sweep.mjs`'s `absent:` line, which reads
// the addon's keys directly and needs no shim.
//
// It becomes the useful check the moment `buffer` publishes enough to be
// shaped, and it fails under `--sabotage` today, naming all fourteen.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const buffer = require("buffer");

function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const expected = fromRealNode('Object.keys(require("node:buffer")).sort()');
const nodeTypes = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:buffer"))' +
    '.map((k) => [k, typeof require("node:buffer")[k]]))',
);

assert.ok(
  expected.length >= 10,
  `node's buffer exports ${expected.length} names, too few to be real`,
);

const actual = new Set(Object.keys(buffer));
const missing = expected.filter((name) => !actual.has(name));
assert.deepStrictEqual(
  missing,
  [],
  `buffer is missing name(s) node has: ${missing.join(", ")}`,
);

// Collected rather than asserted one at a time. `shape.mjs` gives every name a
// key, so `missing` above is empty and every absent export lands here -- and
// asserting inside the loop reported `Blob` and stopped, which says "one name is
// wrong" about a surface where twelve are. The whole list is the finding.
const wrongType = [];
for (const name of expected) {
  const ours = typeof buffer[name];
  if (ours !== nodeTypes[name]) wrongType.push(`${name}: ${ours}, node's ${nodeTypes[name]}`);
}
// Asserted below, together with the callability findings. Asserting here would
// hide those behind these -- which is the same defect this loop was just fixed
// for, one level out: a file that reports its first finding and stops is a file
// whose other findings do not exist until the first is repaired.

// **And that each published function can be called.**
//
// Node has no reason to assert this: there, a name of type `function` is always
// callable. Here it is not. The erased-parameter crossing published `isUtf8` and
// `isAscii`, both declared `(input: Uint8Array | ArrayBuffer)`, and the boundary
// has no inbound representation for a typed array -- so `typeof buffer.isUtf8`
// became `"function"` while every argument node accepts throws, `Buffer`
// included. A presence check passes where it used to fail honestly.
//
// Scalars are not enough to catch it: `isUtf8("")` reaches the module's own
// validation and answers node's error correctly. Only the argument the function
// actually takes finds the boundary.
const callable = [];
for (const [name, args, want] of [
  ["isUtf8", [new Uint8Array([0x61, 0x62])], true],
  ["isUtf8", [new Uint8Array([0xff, 0xfe])], false],
  ["isAscii", [new Uint8Array([0x61])], true],
  ["isAscii", [new Uint8Array([0x80])], false],
]) {
  if (typeof buffer[name] !== "function") continue;
  try {
    const got = buffer[name](...args);
    if (got !== want) callable.push(`${name} answered ${got}, node answers ${want}`);
  } catch (error) {
    callable.push(`${name} threw: ${error.message}`);
  }
}
const surface = [
  ...wrongType.map((line) => `absent or wrong type -- ${line}`),
  ...callable.map((line) => `published but not callable -- ${line}`),
];
assert.deepStrictEqual(
  surface,
  [],
  `${wrongType.length} name(s) differ in type from node and ` +
    `${callable.length} published function(s) cannot be called:\n  ${surface.join("\n  ")}`,
);

// The two numeric constants, pinned by value. They are the export kind the
// backend was dropping: a literal initializer folded into its readers leaves
// nothing for the export table to point at, so `INSPECT_MAX_BYTES = 50` was
// absent while `kMaxLength = 2 ** 53 - 1` was present. Asserting the values
// means a change to how constants are published cannot quietly take them again.
assert.strictEqual(buffer.kMaxLength, fromRealNode('require("node:buffer").kMaxLength'));
assert.strictEqual(
  buffer.kStringMaxLength,
  fromRealNode('require("node:buffer").kStringMaxLength'),
);
assert.strictEqual(
  buffer.INSPECT_MAX_BYTES,
  fromRealNode('require("node:buffer").INSPECT_MAX_BYTES'),
);

// `constants` is an object of numbers; published empty it would satisfy every
// check above.
const nodeConstants = fromRealNode('require("node:buffer").constants');
assert.strictEqual(typeof buffer.constants, "object");
assert.notStrictEqual(buffer.constants, null);
for (const name of Object.keys(nodeConstants)) {
  assert.strictEqual(
    buffer.constants[name],
    nodeConstants[name],
    `buffer.constants.${name} is ${buffer.constants[name]}, node's is ${nodeConstants[name]}`,
  );
}

// And that `Buffer` is the class rather than a name of the right type: a round
// trip through the two operations every other test in this module depends on.
const made = buffer.Buffer.from("aéb", "utf8");
assert.strictEqual(made.length, 4);
assert.strictEqual(made.toString("utf8"), "aéb");
