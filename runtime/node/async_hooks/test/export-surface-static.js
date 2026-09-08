// Every name node's `async_hooks` has, with its type, and both directions.
//
// This module builds as a compiled addon and passes none of its 115 applicable
// files. The reason is not behaviour: the raw addon publishes **thirteen**
// names, of which only two — `executionAsyncId` and `triggerAsyncId` — are
// node's. The other eleven are internal (`emitAfter`, `newAsyncId`,
// `popAsyncContext`, ...) and node exports none of them; five of node's seven
// are absent entirely.
//
// `shape.mjs` builds the public surface out of those internals, so
// `Object.keys(require("async_hooks"))` is node's seven either way. **A test
// that checked names would pass vacuously**, which is the same trap
// `path/test/export-surface-static.js` documents from the other side: a shape
// shim manufactures the keys, so only the values carry information.
//
// Node's answers come from a child `node -p`. Inside this harness
// `require("node:async_hooks")` and `require("async_hooks")` are the *same
// object* — the module under test is substituted for both spellings — so an
// oracle taken that way compares a thing with itself. One test in this profile
// did exactly that and passed for it; `tooling/conformance/self-oracle.mjs`
// checks the rest.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const asyncHooks = require("async_hooks");

/** What a clean node says about its own module, with no harness in the way. */
function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const expected = fromRealNode('Object.keys(require("node:async_hooks")).sort()');
const nodeTypes = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:async_hooks"))' +
    '.map((k) => [k, typeof require("node:async_hooks")[k]]))',
);

// The floor. A `node -p` that failed leaves `expected` empty, every filter below
// returns nothing, and the file passes having checked nothing.
assert.ok(
  expected.length >= 7,
  `node's async_hooks exports ${expected.length} names, too few to be real`,
);

const actual = new Set(Object.keys(asyncHooks));
const missing = expected.filter((name) => !actual.has(name));
assert.deepStrictEqual(
  missing,
  [],
  `async_hooks is missing name(s) node has: ${missing.join(", ")}`,
);

// The direction the shim cannot fake: a name present but bound to nothing.
for (const name of expected) {
  assert.strictEqual(
    typeof asyncHooks[name],
    nodeTypes[name],
    `async_hooks.${name} is ${typeof asyncHooks[name]}, node's is ${nodeTypes[name]}`,
  );
}

// And that nothing internal reached the public surface. Node exports seven
// names; publishing `emitAfter` or `newAsyncId` alongside them is a divergence
// in the direction nobody looks, and it is the direction this module's raw
// addon actually goes wrong in.
const extra = [...actual].filter((name) => !expected.includes(name)).sort();
assert.deepStrictEqual(
  extra,
  [],
  `async_hooks publishes name(s) node does not: ${extra.join(", ")}`,
);
