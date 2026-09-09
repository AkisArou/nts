// `getDefaultHighWaterMark` is the one thing the compiled `stream` publishes,
// and it answers correctly.
//
// The addon publishes exactly one name. Its two upstream passes were both
// hollow -- `stream.Readable` and `require('_stream_readable')` are equal
// because both are `undefined`, and `require('stream/web')` is Node's own on
// both sides -- so removing them took the module off the compiled axis
// entirely. This is what it can actually demonstrate.
//
// # Why the argument matters
//
// A single default is a shape question: `--mutate-addon` keeps the names and
// destroys behaviour, and a stub answering one constant satisfies "returns a
// number". `getDefaultHighWaterMark` takes a flag and answers differently:
//
//     getDefaultHighWaterMark(false)      65536      byte streams
//     getDefaultHighWaterMark(true)       16         object mode
//     getDefaultHighWaterMark(undefined)  65536      absent is not object mode
//
// Two different answers from one function is what a constant cannot fake, and
// the third row is the one an implementation gets wrong -- `undefined` is
// falsy and must take the byte-stream branch rather than being rejected.
//
// Checked against node 24.20.0 directly, and against the addon, before writing
// this: all three agree.
//
// There is no round-trip here because `setDefaultHighWaterMark` is not
// published. When it is, this file should grow one -- a write observed by the
// next read is a stronger statement than any number of correct defaults.
"use strict";

require("../common");

const assert = require("assert");
const stream = require("stream");

assert.strictEqual(
  typeof stream.getDefaultHighWaterMark,
  "function",
  "stream.getDefaultHighWaterMark is missing",
);

const byteMode = stream.getDefaultHighWaterMark(false);
const objectMode = stream.getDefaultHighWaterMark(true);

assert.strictEqual(typeof byteMode, "number", "the byte-stream default is not a number");
assert.strictEqual(typeof objectMode, "number", "the object-mode default is not a number");

assert.strictEqual(byteMode, 65536, "the byte-stream default is not 65536");
assert.strictEqual(objectMode, 16, "the object-mode default is not 16");

// The two answers have to differ, which is what a constant cannot do.
assert.notStrictEqual(
  byteMode,
  objectMode,
  "one value is answered for both modes, so the argument is not being read",
);

// `undefined` is falsy and takes the byte-stream branch. An implementation that
// validates the flag instead of coercing it fails here.
assert.strictEqual(
  stream.getDefaultHighWaterMark(undefined),
  byteMode,
  "an absent flag did not take the byte-stream branch",
);
