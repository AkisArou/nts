// `util.promisify.custom`, `util.inherits` and `util._extend` — three names node publishes that
// this profile did not, and one of them was a behaviour rather than a name.
//
// `surface-absence.mjs` listed nine missing `util` paths for as long as it has existed. What a
// surface list cannot say is that the *branch* behind `promisify.custom` was missing too: node's
// `promisify` returns a function's own declared promisified form if it has one, and `fs` and
// `child_process` both rely on that upstream, so `util.promisify(fs.exists)` gets node's
// single-argument form rather than an `(err, value)` misreading.
//
// The symbol is registered rather than private — `Symbol.for("nodejs.util.promisify.custom")` —
// so two copies of the machinery in one process agree on it. That is checked here by its
// description, because a private symbol would pass every other assertion in this file.
//
// Every expectation was read off node before it was written down.
"use strict";

const common = require("../common");

const assert = require("assert");
const util = require("util");

const finished = common.mustCall(() => {});

function callbackStyle(cb) { cb(null, "callback"); }
callbackStyle[util.promisify.custom] = () => Promise.resolve("custom");

assert.strictEqual(
  String(util.promisify.custom),
  "Symbol(nodejs.util.promisify.custom)",
  "promisify.custom must be the registered symbol, not a private one",
);

// `inherits` sets the chain and records `super_`.
function Parent() {}
Parent.prototype.hello = function hello() { return "parent"; };
function Child() {}
util.inherits(Child, Parent);
assert.strictEqual(new Child().hello(), "parent", "the prototype chain was not set");
assert.strictEqual(Child.super_, Parent, "super_ was not recorded");
const descriptor = Object.getOwnPropertyDescriptor(Child, "super_");
assert.strictEqual(descriptor.writable, true, "super_ must be writable, as node defines it");
assert.strictEqual(descriptor.configurable, true, "super_ must be configurable");

assert.throws(() => util.inherits(null, Parent), { code: "ERR_INVALID_ARG_TYPE" });
assert.throws(() => util.inherits(Child, null), { code: "ERR_INVALID_ARG_TYPE" });

// `_extend` copies own enumerable keys, and returns `target` untouched for a non-object source.
assert.deepStrictEqual(util._extend({ a: 1 }, { b: 2 }), { a: 1, b: 2 });
assert.deepStrictEqual(util._extend({ a: 1 }, null), { a: 1 });
assert.deepStrictEqual(util._extend({ a: 1 }, 5), { a: 1 });

// A function declaring a non-function custom form is rejected, naming the property.
const bad = () => {};
bad[util.promisify.custom] = 5;
assert.throws(() => util.promisify(bad), { code: "ERR_INVALID_ARG_TYPE" });

(async () => {
  assert.strictEqual(await util.promisify(callbackStyle)(), "custom",
    "promisify must return the declared custom form");

  // And a function without one still gets the ordinary (err, value) wrapper, which is the
  // control: if the branch always fired, this would throw rather than resolve.
  assert.strictEqual(await util.promisify((cb) => cb(null, "ordinary"))(), "ordinary");

  finished();
})();
