"use strict";

// `Object.prototype.toString.call(process)` is `"[object process]"`.
//
// Node's descriptor here is writable and **non**-configurable, where `console`'s
// is non-writable and configurable. Two module objects, two different answers,
// so neither was inferred from the other.

require("../common");
const assert = require("assert");

assert.strictEqual(Object.prototype.toString.call(process), "[object process]");
assert.strictEqual(process[Symbol.toStringTag], "process");

const descriptor = Object.getOwnPropertyDescriptor(process, Symbol.toStringTag);
assert.strictEqual(descriptor.writable, true);
assert.strictEqual(descriptor.enumerable, false);
assert.strictEqual(descriptor.configurable, false);
