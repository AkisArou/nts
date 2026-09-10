"use strict";

// `stream.promises` is an ordinary object, not an ESM module namespace.
//
// `promises.ts` is reached with `import * as promises`, so what the shim copied
// was frozen, null-prototyped and tagged `"Module"`. Node's is an ordinary object
// over `Object.prototype` with no tag -- and note that it differs from
// `fs.constants`, which really is null-prototyped. The two were measured
// separately for that reason.
//
// The subpath must be the same object as the property, which is the part a
// rebuild can quietly break.

require("../common");
const assert = require("assert");
const stream = require("stream");
const streamPromises = require("stream/promises");

assert.strictEqual(stream.promises[Symbol.toStringTag], undefined);
assert.strictEqual(Object.isExtensible(stream.promises), true);
assert.strictEqual(Object.getPrototypeOf(stream.promises), Object.prototype);
assert.strictEqual(typeof stream.promises.finished, "function");
assert.strictEqual(typeof stream.promises.pipeline, "function");

assert.strictEqual(
  streamPromises,
  stream.promises,
  "require('stream/promises') must be require('stream').promises",
);
