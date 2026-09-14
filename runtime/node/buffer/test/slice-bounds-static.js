// The per-encoding `*Slice` methods check their bounds; `toString` clamps. Both are node's.
//
// `toString(encoding, start, end)` clamps out-of-range bounds. `utf8Slice` and its six siblings come
// from node's C++ binding and throw `ERR_OUT_OF_RANGE` — and this profile routed both through one
// decoder, so all seven clamped. 214 of 4,025 differential inputs diverged on it.
//
// **The order of the checks is the part that is easy to get wrong**, because two of node's answers
// look inconsistent until it is written down:
//
//     Buffer.from("ABCD"):  0,5 -> throws     5,5 -> ""      2,1 -> ""      0,-1 -> throws
//     Buffer.from("AB"):    3,4 -> throws
//
// `5,5` is empty and `3,4` on a two-byte buffer throws because `start >= end` answers `""` *before*
// the length is consulted, while a negative bound throws before even that. And an empty buffer takes
// a fast path ahead of all of it: any bounds at all answer `""`.
//
// Every expectation below was read off node before it was written here.
"use strict";

require("../common");

const assert = require("assert");
const { Buffer } = require("buffer");

const SLICERS = ["utf8Slice", "asciiSlice", "latin1Slice", "hexSlice", "base64Slice",
  "base64urlSlice", "ucs2Slice"];

const four = Buffer.from("ABCD", "utf8");

// The control: a slice in range must actually return the bytes. Without it, a family that threw
// unconditionally would satisfy every rejection below.
assert.strictEqual(four.utf8Slice(0, 4), "ABCD");
assert.strictEqual(four.utf8Slice(1, 3), "BC");
assert.strictEqual(four.hexSlice(0, 2), "4142");

for (const method of SLICERS) {
  assert.strictEqual(typeof four[method], "function", `${method} is missing`);

  // An end past the buffer, a start past it, and a negative bound are all errors.
  assert.throws(() => four[method](0, 5), { code: "ERR_OUT_OF_RANGE" }, `${method}(0, 5)`);
  assert.throws(() => four[method](-1, 2), { code: "ERR_OUT_OF_RANGE" }, `${method}(-1, 2)`);
  assert.throws(() => four[method](0, -1), { code: "ERR_OUT_OF_RANGE" }, `${method}(0, -1)`);

  // `start >= end` is empty and is decided *before* the length, so a start past the end of the
  // buffer is empty rather than an error when the end is not beyond it.
  assert.strictEqual(four[method](2, 1), "", `${method}(2, 1)`);
  assert.strictEqual(four[method](5, 5), "", `${method}(5, 5)`);
  assert.strictEqual(four[method](4, 4), "", `${method}(4, 4)`);

  // Bounds are truncated toward zero, and a non-number start becomes 0.
  assert.strictEqual(four[method](1.9, 3), four[method](1, 3), `${method} truncates start`);
  assert.strictEqual(four[method](0, 3.9), four[method](0, 3), `${method} truncates end`);
  assert.strictEqual(four[method](NaN, 3), four[method](0, 3), `${method}(NaN, 3)`);

  // An empty buffer answers "" to anything, ahead of every check above.
  assert.strictEqual(Buffer.alloc(0)[method](1, 3), "", `empty ${method}(1, 3)`);
  assert.strictEqual(Buffer.alloc(0)[method](0, 2), "", `empty ${method}(0, 2)`);
}

// And `toString` still clamps, which is the half that must not change.
assert.strictEqual(four.toString("utf8", 0, 99), "ABCD", "toString must clamp, not throw");
assert.strictEqual(four.toString("utf8", -5, 2), "AB", "toString must clamp a negative start");
