// `stream`'s twenty-three names, and the three identities that are not names.
//
// The module compiles and publishes **zero**. Its wrapper diagnostics split
// 11 / 16 / 2 -- eleven the backend cannot name, sixteen functions never
// compiled, two signatures that do not cross. Both `export-class` arms and the
// refusal queue, in one module.
//
// It carries more weight than its own tests suggest: `net`, `http`, `readline`,
// `process` and `zlib` all build on these classes, so a surface that is wrong
// here is wrong in five other modules, and the failure arrives somewhere else.
//
// Node's answers come from a child `node -p`: inside this harness
// `require("node:stream")` and `require("stream")` are the same object.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const stream = require("stream");

function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const expected = fromRealNode('Object.keys(require("node:stream")).sort()');
const nodeTypes = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:stream"))' +
    '.map((k) => [k, typeof require("node:stream")[k]]))',
);

assert.ok(
  expected.length >= 20,
  `node's stream exports ${expected.length} names, too few to be real`,
);

// `_isArrayBufferView`, `_isUint8Array` and `_uint8ArrayToBuffer` are node's
// own helpers, attached to the module for its internals to reach. Excluded, and
// checked before excluding: none appears in `doc/api/stream.md` and none is
// called by any pinned test.
//
// The `_` prefix is the reason they are grouped, not the rule that excludes
// them. `audit.mjs --exports` filters `_`-prefixed names from the ledger's
// missing-export register for the same reason, so this agrees with the register
// rather than inventing a second policy -- but `path._makeLong` is public API in
// this same profile, so a prefix rule would be wrong as a rule. These three are
// named.
const internals = new Set(["_isArrayBufferView", "_isUint8Array", "_uint8ArrayToBuffer"]);

const actual = new Set(Object.keys(stream));
const missing = expected.filter((name) => !actual.has(name) && !internals.has(name));
assert.deepStrictEqual(missing, [], `stream is missing name(s) node has: ${missing.join(", ")}`);

for (const name of expected) {
  if (internals.has(name)) continue;
  assert.strictEqual(
    typeof stream[name],
    nodeTypes[name],
    `stream.${name} is ${typeof stream[name]}, node's is ${nodeTypes[name]}`,
  );
}

// **The module is `Stream`.** `require("stream") === require("stream").Stream`
// in node, the same self-reference `events` has, and for the same reason: the
// legacy `Stream` class is what the module used to be. Nothing in a key list
// sees it, and `class X extends require("stream")` depends on it.
assert.strictEqual(stream, stream.Stream, "the module is not Stream");

// **The hierarchy is real, not five independent classes.** `Duplex` extends
// `Readable`, `Transform` extends `Duplex`, `PassThrough` extends `Transform`,
// and every one extends `Stream` and therefore `EventEmitter`. Five classes with
// the right names and no inheritance satisfy every check above and break every
// `instanceof` in five other modules.
assert.ok(stream.Readable.prototype instanceof stream.Stream, "Readable does not extend Stream");
assert.ok(stream.Writable.prototype instanceof stream.Stream, "Writable does not extend Stream");
assert.ok(stream.Duplex.prototype instanceof stream.Readable, "Duplex does not extend Readable");
assert.ok(stream.Transform.prototype instanceof stream.Duplex, "Transform does not extend Duplex");
assert.ok(
  stream.PassThrough.prototype instanceof stream.Transform,
  "PassThrough does not extend Transform",
);
// `Stream` extends `EventEmitter`, but **not one this test can name.**
//
// The first version asserted `stream.Stream.prototype instanceof
// require("events").EventEmitter` and it failed. The chain is right --
// `EventEmitter -> Object` -- and the classes are two different objects: our
// `Stream` extends the `EventEmitter` it imports by relative path, while the
// test's `require("events")` returns **node's**, because `stream/uses` does not
// list `events` and a `uses` file is what substitutes our implementation for
// node's in a module's tests.
//
// That is deliberate on the harness's part and not a defect here: `stream`'s
// tests keep node's `events` as a stable dependency so only `stream` is under
// test. Adding `events` to `stream/uses` to make the assertion pass would change
// what these 249 files are testing, which is exactly the mistake that cost ten
// passing tests in `http` and `process` earlier today.
//
// So the checkable form is structural: the base is an `EventEmitter` by shape,
// and an instance dispatches events. That is what the assertion is for, and it
// does not depend on which `EventEmitter` object the test can reach.
const base = Object.getPrototypeOf(stream.Stream.prototype);
assert.notStrictEqual(base, null, "Stream has no base");
assert.strictEqual(
  base.constructor.name,
  "EventEmitter",
  `Stream's base is ${base.constructor.name}, not EventEmitter`,
);
for (const member of ["on", "emit", "once", "removeListener"]) {
  assert.strictEqual(typeof base[member], "function", `Stream's base lacks ${member}`);
}

// **And an instance actually flows.** A hierarchy of the right shape and inert
// would pass everything above; this is the one assertion that needs the
// implementation.
const readable = stream.Readable.from(["a", "b"]);
const seen = [];
readable.on("data", (chunk) => { seen.push(String(chunk)); });
readable.on("end", () => {
  assert.deepStrictEqual(seen, ["a", "b"], "a Readable did not deliver its chunks");
});
