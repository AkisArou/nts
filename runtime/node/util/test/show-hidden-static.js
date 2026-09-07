// `showHidden`, which `%o` is, and which nothing here asserted.
//
// `util.format("%o", x)` is `inspect(x, { showHidden: true, depth: 4 })`, so
// every `%o` in a program depends on this. A differential against node over 800
// generated format templates found 101 divergences, all of them an array
// printing without its `[length]`.
//
// This profile reports the hidden properties it can name statically. It does
// not report a function's `[name]`, `[arguments]`, `[caller]` or `[prototype]`
// -- those are the function metadata §13 refuses, and no amount of `showHidden`
// changes that. The assertions below are the part that is implementable, and
// the refusal has its own assertion so that a future change to it is visible.
"use strict";

require("../common");

const assert = require("assert");
const util = require("util");

const hidden = { showHidden: true };

assert.strictEqual(util.inspect([2, 3], hidden), "[ 2, 3, [length]: 2 ]");
assert.strictEqual(util.inspect([], hidden), "[ [length]: 0 ]");
assert.strictEqual(util.inspect({ xs: [1, 2] }, hidden), "{ xs: [ 1, 2, [length]: 2 ] }");

// Without it, nothing changes.
assert.strictEqual(util.inspect([2, 3]), "[ 2, 3 ]");

// A typed array reports five, in node's declaration order rather than
// alphabetically, and its `[buffer]` is spelled *without* `[Uint8Contents]`:
// node suppresses those bytes when the buffer is reached through a typed array,
// having just printed the same bytes as the elements.
assert.strictEqual(
  util.inspect(new Uint8Array([1, 2]), hidden),
  "Uint8Array(2) [\n  1,\n  2,\n  [BYTES_PER_ELEMENT]: 1,\n  [length]: 2,\n" +
    "  [byteLength]: 2,\n  [byteOffset]: 0,\n  [buffer]: ArrayBuffer { [byteLength]: 2 }\n]",
);

// `%o` is the reason any of this matters.
assert.strictEqual(util.format("%o", [1, 2]), "[ 1, 2, [length]: 2 ]");
assert.strictEqual(util.format("%o", { a: 1, b: [2, 3] }), "{ a: 1, b: [ 2, 3, [length]: 2 ] }");
// `%O` is the same inspect without `showHidden`, which is the pair's whole
// difference and the reason a test that only checked `%o` could pass by
// accident.
assert.strictEqual(util.format("%O", { a: 1, b: [2, 3] }), "{ a: 1, b: [ 2, 3 ] }");

// Kinds that have nothing to add are unchanged, so a blanket "show everything"
// would fail here rather than pass.
assert.strictEqual(util.inspect({ a: 1 }, hidden), "{ a: 1 }");
assert.strictEqual(util.inspect(new Map([[1, 2]]), hidden), "Map(1) { 1 => 2 }");
assert.strictEqual(util.inspect(new Set([1]), hidden), "Set(1) { 1 }");

// The refusal, asserted so that changing it is a decision rather than a drift.
// Node prints
//   <ref *1> [Function: f] { [length]: 2, [name]: 'f', [arguments]: null,
//                            [caller]: null, [prototype]: { ... } }
// and this prints `[Function]` -- not `[Function: f]`, because a compiled
// function is a pointer and its `.name` is the same §13 refusal that keeps
// `[name]` out of the list above. Writing this assertion is what showed me
// that: I expected `[Function: f]` and the test failed.
assert.strictEqual(util.inspect(function f(a, b) {}, hidden), "[Function]");
assert.strictEqual(util.inspect(function f(a, b) {}), "[Function]");
