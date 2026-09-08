// `assert`'s twenty-one names, and the two things about its surface that no
// name check can see.
//
// This module compiles and publishes **zero of twenty-five**. Its wrapper
// diagnostics split 21 / 2 / 2, and the 21 are almost all one shape:
//
//     export const deepEqual = looseAssertions.deepEqual;
//
// A `const` bound to a function taken off an object -- not a declaration. The
// backend can publish a top-level function and cannot publish that, which is the
// second arm of `export-class`: publishing an export that is not a top-level
// function declaration. `assert` is the extreme case, so it is the module where
// that arm is most visible.
//
// Written before the fix lands, because when it does the interesting question is
// not how many of its eleven files pass but whether the surface is real.
//
// Node's answers come from a child `node -p`: inside this harness
// `require("node:assert")` and `require("assert")` are the same object.
//
// **One thing this file cannot do, and it is inherent to the module.** Its
// assertion library *is* the module under test. Under `--sabotage` it fails
// with `assert.ok is not a function` -- from its own first check, before any
// substance -- so it cannot distinguish a blank `assert` from a wrong one. Every
// test in this directory has that property and none of them can avoid it; the
// only oracle that would is a second assertion library, which would be a
// stranger dependency than the gap is worth. Recorded so the next reader does
// not mistake the sabotage message for a finding.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");

function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const expected = fromRealNode('Object.keys(require("node:assert")).sort()');
const nodeTypes = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:assert"))' +
    '.map((k) => [k, typeof require("node:assert")[k]]))',
);

assert.ok(
  expected.length >= 20,
  `node's assert exports ${expected.length} names, too few to be real`,
);

const actual = new Set(Object.keys(assert));
const missing = expected.filter((name) => !actual.has(name));
assert.deepStrictEqual(missing, [], `assert is missing name(s) node has: ${missing.join(", ")}`);

for (const name of expected) {
  assert.strictEqual(
    typeof assert[name],
    nodeTypes[name],
    `assert.${name} is ${typeof assert[name]}, node's is ${nodeTypes[name]}`,
  );
}

const extra = [...actual].filter((name) => !expected.includes(name)).sort();
assert.deepStrictEqual(extra, [], `assert publishes name(s) node does not: ${extra.join(", ")}`);

// **The module itself is callable.** `require("assert")(false)` throws, and no
// enumeration of keys can see that: a namespace object with all twenty-one
// names and no call behaviour satisfies every check above.
assert.strictEqual(typeof assert, "function");
assert.throws(() => assert(false), { name: "AssertionError" });
assert.doesNotThrow(() => assert(true));

// **`strict` is a distinct surface, not an alias for the module.** Node's
// `assert.strict.equal` is `strictEqual`; the loose `assert.equal` is not. A
// published `strict` that pointed back at the loose namespace would pass a
// typeof check and quietly make `==` comparisons out of `===` ones.
assert.strictEqual(typeof assert.strict, "function");
assert.doesNotThrow(() => assert.strict.equal(1, 1));
assert.throws(() => assert.strict.equal(1, "1"), { name: "AssertionError" });
assert.doesNotThrow(() => assert.equal(1, "1"));

// And the alias arm reaches its implementation: `deepEqual` is a `const` bound
// to a method off another object, so a surface that published the name without
// the binding would be the exact failure this module's exports are stuck on.
assert.doesNotThrow(() => assert.deepEqual({ a: 1 }, { a: "1" }));
assert.throws(() => assert.deepStrictEqual({ a: 1 }, { a: "1" }), { name: "AssertionError" });
