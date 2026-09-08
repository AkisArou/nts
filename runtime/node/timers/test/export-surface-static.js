// Every name node's `timers` has, with its type, and both directions.
//
// Written while this module does not compile, so that the day it does the first
// question has an answer. It is two clang errors away and both are fixtured;
// when they go, the interesting number is not how many of its 55 files pass but
// whether the addon published enough for those passes to mean anything.
//
// `buffer` is the cautionary case: it compiles, publishes 3 of its 15 exports,
// and reports 55 failures that are one fact. `async_hooks` publishes thirteen
// names of which only two are node's.
//
// Node's answers come from a child `node -p`. Inside this harness
// `require("node:timers")` and `require("timers")` are the **same object** --
// the module under test is substituted for both spellings -- so an oracle taken
// that way compares a thing with itself.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const timers = require("timers");

function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const expected = fromRealNode('Object.keys(require("node:timers")).sort()');
const nodeTypes = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:timers"))' +
    '.map((k) => [k, typeof require("node:timers")[k]]))',
);

// The floor: a failed child leaves `expected` empty and every check below
// vacuous.
assert.ok(
  expected.length >= 7,
  `node's timers exports ${expected.length} names, too few to be real`,
);

const actual = new Set(Object.keys(timers));
const missing = expected.filter((name) => !actual.has(name));
assert.deepStrictEqual(
  missing,
  [],
  `timers is missing name(s) node has: ${missing.join(", ")}`,
);

for (const name of expected) {
  assert.strictEqual(
    typeof timers[name],
    nodeTypes[name],
    `timers.${name} is ${typeof timers[name]}, node's is ${nodeTypes[name]}`,
  );
}

const extra = [...actual].filter((name) => !expected.includes(name)).sort();
assert.deepStrictEqual(
  extra,
  [],
  `timers publishes name(s) node does not: ${extra.join(", ")}`,
);

// `promises` is the one nested value on this surface, and the only place the
// backend has to publish something that is neither a function nor a scalar.
// Node's has four names; a `promises` published as an empty object would
// satisfy every check above.
const expectedPromises = fromRealNode(
  'Object.keys(require("node:timers").promises).sort()',
);
assert.ok(expectedPromises.length >= 3, "node's timers.promises looks empty");
assert.strictEqual(typeof timers.promises, "object");
assert.notStrictEqual(timers.promises, null);
const missingPromises = expectedPromises.filter(
  (name) => !(name in timers.promises),
);
assert.deepStrictEqual(
  missingPromises,
  [],
  `timers.promises is missing: ${missingPromises.join(", ")}`,
);

// And that the clear functions accept what the set functions return, which a
// surface of correctly-typed names bound to the wrong implementations would
// not. Cleared immediately, so nothing is left pending.
const handle = timers.setTimeout(() => {}, 3600_000);
assert.strictEqual(typeof handle, "object");
timers.clearTimeout(handle);

const immediate = timers.setImmediate(() => {});
assert.strictEqual(typeof immediate, "object");
timers.clearImmediate(immediate);
