"use strict";

// `duplex instanceof Writable` is true, and it is not duck-typing.
//
// Node's `Duplex extends Readable`, not `Writable`, so an ordinary prototype walk
// says no. Node adds a `Symbol.hasInstance` to `Writable`:
//
//     if (FunctionPrototypeSymbolHasInstance(this, instance)) return true;
//     if (this !== Writable) return false;
//     return instance && instance._writableState instanceof WritableState;
//
// Both halves are asserted, because copying only the first half would make this
// pass while turning `instanceof` into a shape test. A plain object carrying
// `_writableState: {}` is **not** an instance, and neither is one with `write`,
// `end` and `on` -- the state has to be a real `WritableState`.
//
// Nothing upstream asserts it: on node the property is installed beside the class
// and cannot be absent, and the negative cases are things nobody would write.
//
// `Writable.WritableState` and `Readable.ReadableState` are asserted alongside
// because the predicate needs the class, and because node puts them exactly there
// -- `Object.keys(stream.Writable)` is `["WritableState", "fromWeb", "toWeb"]` --
// and *not* on the module object.

require("../common");
const assert = require("assert");
const stream = require("stream");
const { Readable, Writable, Duplex, Transform } = stream;

// The state classes, where node keeps them.
assert.strictEqual(typeof Writable.WritableState, "function");
assert.strictEqual(typeof Readable.ReadableState, "function");
assert.strictEqual("WritableState" in stream, false, "not on the module object");
assert.strictEqual("ReadableState" in stream, false, "not on the module object");

// Anything with a real writable half is an instance.
assert.ok(new Writable() instanceof Writable);
assert.ok(new Duplex() instanceof Writable, "a Duplex is a Writable, via hasInstance");
assert.ok(new Transform() instanceof Writable);

// And nothing else is. These are the assertions that keep it from being a shape
// test: each would pass under a duck-typed predicate.
assert.strictEqual(new Readable() instanceof Writable, false);
assert.strictEqual({ _writableState: {} } instanceof Writable, false);
assert.strictEqual({ write() {}, end() {}, on() {} } instanceof Writable, false);
assert.strictEqual({} instanceof Writable, false);
assert.strictEqual(null instanceof Writable, false);
assert.strictEqual(42 instanceof Writable, false);

// The readable half is unaffected: a Duplex really does inherit from Readable.
assert.ok(new Duplex() instanceof Readable);
assert.strictEqual(new Writable() instanceof Readable, false);
