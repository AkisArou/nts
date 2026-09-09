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
//
// Collected rather than asserted in the loop. Asserting inside it reported
// `AsyncLocalStorage` and stopped, which hid both of the checks below -- and the
// `extra` one is, by this file's own comment, the direction this module's raw
// addon actually goes wrong in. A file that reports its first finding and stops
// is a file whose other findings do not exist until the first is repaired.
const wrongType = [];
for (const name of expected) {
  const ours = typeof asyncHooks[name];
  if (ours !== nodeTypes[name]) wrongType.push(`${name}: ${ours}, node's ${nodeTypes[name]}`);
}

// **And that each published function can be called.**
//
// Node has no reason to assert this: there, a name of type `function` is always
// callable. Here it is not. `executionAsyncResource` publishes and throws `the
// compiled function returned a value with no JavaScript representation` -- an
// outbound failure, where `buffer.isUtf8`'s is inbound. `typeof` cannot see
// either, and a surface test that stops at `typeof` reports a module in better
// shape than it is.
const uncallable = [];
for (const [name, want] of [
  ["executionAsyncId", "number"],
  ["triggerAsyncId", "number"],
  ["executionAsyncResource", "object"],
]) {
  if (typeof asyncHooks[name] !== "function") continue;
  try {
    const got = typeof asyncHooks[name]();
    if (got !== want) uncallable.push(`${name}() answered a ${got}, node answers an ${want}`);
  } catch (error) {
    uncallable.push(`${name}() threw: ${error.message}`);
  }
}

// And that nothing internal reached the public surface. Node exports seven
// names; publishing `emitAfter` or `newAsyncId` alongside them is a divergence
// in the direction nobody looks, and it is the direction this module's raw
// addon actually goes wrong in.
const extra = [...actual].filter((name) => !expected.includes(name)).sort();

// All three findings at once, so none hides the others.
const surface = [
  ...wrongType.map((line) => `absent or wrong type -- ${line}`),
  ...uncallable.map((line) => `published but not callable -- ${line}`),
  ...extra.map((name) => `published and node has no such name -- ${name}`),
];
assert.deepStrictEqual(
  surface,
  [],
  `${wrongType.length} wrong type, ${uncallable.length} uncallable, ` +
    `${extra.length} published that node does not have:\n  ${surface.join("\n  ")}`,
);
