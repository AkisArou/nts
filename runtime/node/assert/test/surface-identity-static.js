"use strict";

// Which names `assert` and `assert.strict` share as the *same function object*,
// and which they do not. Node has no reason to test this -- it is an invariant
// of how its own two surfaces are built, not a behaviour a user reported -- so
// nothing upstream asserts it and nothing here did either until now.
//
// It matters because the obvious way to make `assert` publish on the compiled
// axis is to rewrite its eighteen `export const X = looseAssertions.X` as
// eighteen `export function X`. That would make every name a distinct object
// and quietly break the sharing below, while every existing test kept passing:
// each assertion would still *do* the right thing, and only identity would
// change.
//
// The contract is per name and not uniform, which is the whole point:
//
//   - `ok` has no loose/strict variance, so both surfaces expose one function;
//   - `deepEqual` differs between them, so they must be two;
//   - `assert` and `assert.strict` are themselves different objects, and
//     `assert.strict.strict` is a self-reference.
//
// Measured against node 24 rather than assumed.

const assert = require("assert");

// Shared: no loose/strict variance, so one function object serves both.
for (const name of ["ok", "fail", "ifError"]) {
  assert.strictEqual(
    assert[name],
    assert.strict[name],
    `assert.${name} and assert.strict.${name} should be the same function`,
  );
}

// Distinct: the loose and strict forms are different implementations.
for (const name of ["deepEqual", "notDeepEqual", "equal", "notEqual"]) {
  assert.notStrictEqual(
    assert[name],
    assert.strict[name],
    `assert.${name} and assert.strict.${name} should differ`,
  );
}

// The two surfaces are different objects, and `strict` is a fixed point.
assert.notStrictEqual(assert, assert.strict);
assert.strictEqual(assert.strict.strict, assert.strict);

// `ok` on both surfaces is the loose callable itself -- one function under
// three names. This is the exact shape that was wrong: `assert.ok` was right
// and `assert.strict.ok` was the strict callable instead.
assert.strictEqual(assert.ok, assert);
assert.strictEqual(assert.strict.ok, assert);
assert.notStrictEqual(assert.strict.ok, assert.strict);

// Both surfaces are callable, which an ESM export cannot be. Recorded here so
// that a module which publishes every name and is still not callable reads as
// incomplete rather than done.
assert.strictEqual(typeof assert, "function");
assert.strictEqual(typeof assert.strict, "function");
