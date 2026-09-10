"use strict";

// `Object.prototype.toString.call(console)` is `"[object console]"`.
//
// It needs an own `Symbol.toStringTag`, which is invisible to `Object.keys` and
// so to every surface check that walks string keys. Node's descriptor is
// non-writable, non-enumerable and configurable -- `process`'s is the opposite on
// two of three, so the two are asserted separately rather than shaped alike.

require("../common");
const assert = require("assert");

assert.strictEqual(Object.prototype.toString.call(console), "[object console]");
assert.strictEqual(console[Symbol.toStringTag], "console");

const descriptor = Object.getOwnPropertyDescriptor(console, Symbol.toStringTag);
assert.strictEqual(descriptor.writable, false);
assert.strictEqual(descriptor.enumerable, false);
assert.strictEqual(descriptor.configurable, true);
