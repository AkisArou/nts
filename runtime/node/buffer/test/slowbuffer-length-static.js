// `SlowBuffer(size)` sizes its result from its argument.
//
// The compiled `buffer` publishes five names and its only pass is
// `test-buffer-constants.js`, a table comparison that survives
// `--mutate-addon`. So `buffer` has been on the axis without demonstrating
// anything it computes.
//
// `SlowBuffer` computes: it takes a length and produces a view of that length.
// Node deprecated it and kept it, and it needs no `Buffer.from`, no encoding,
// and no class crossing -- the result is a `Uint8Array`, which does cross.
//
//     SlowBuffer(0)     length 0
//     SlowBuffer(4)     length 4
//     SlowBuffer(100)   length 100
//     SlowBuffer(1.5)   length 1     truncated, not rounded and not rejected
//
// Checked against `require("node:buffer").SlowBuffer` before writing this: the
// accepted cases agree exactly, including the truncation.
//
// The contents are **not** asserted. `SlowBuffer` is uninitialised by
// definition, so a test reading its bytes would be asserting whatever the
// allocator left there.
//
// # The rejected cases are deliberately absent, and the reason is a probe I
// # nearly believed
//
// `SlowBuffer(-1)`, `(NaN)`, `("4")`, `(undefined)` all throw, and the probe
// that compared them against node printed `e.code ?? e.name` on both sides and
// reported **zero differences across eleven cases**.
//
// That comparison cannot see the difference it exists to find. This profile's
// errors reach the host with `code` **undefined** and the code string in
// `name`, so `??` falls through on our side and prints the same text node's
// `code` prints. The identical output is two different properties.
//
// `runtime/node/timers/test/duration-errors-static.js` is where that is
// asserted properly, and `blockers/class-fields-do-not-cross` is why it fails.
// Repeating it here would add a second failing file for one gap.
"use strict";

require("../common");

const assert = require("assert");
const { SlowBuffer } = require("buffer");

process.on("warning", (w) => {
  if (w.name !== "DeprecationWarning") throw w;
});

assert.strictEqual(typeof SlowBuffer, "function", "SlowBuffer is missing");

for (const size of [0, 1, 4, 100]) {
  const buffer = SlowBuffer(size);
  assert.ok(buffer instanceof Uint8Array, `SlowBuffer(${size}) is not a Uint8Array`);
  assert.strictEqual(buffer.length, size, `SlowBuffer(${size}) has the wrong length`);
}

// Two sizes must give two lengths, which a constant cannot do.
assert.notStrictEqual(
  SlowBuffer(4).length,
  SlowBuffer(5).length,
  "two sizes produced the same length",
);

// Truncated toward zero rather than rounded or rejected.
assert.strictEqual(SlowBuffer(1.5).length, 1, "1.5 was not truncated to 1");
assert.strictEqual(SlowBuffer(0.9).length, 0, "0.9 was not truncated to 0");
