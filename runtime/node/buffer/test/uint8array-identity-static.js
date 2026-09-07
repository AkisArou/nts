// `Buffer` is a `Uint8Array`, which no upstream buffer test asserts.
//
// Searched: **zero** of the 76 `parallel/test-buffer-*.js` files check
// `instanceof Uint8Array`. That is not an oversight. On node, `class Buffer
// extends Uint8Array` cannot produce something that fails the check, so there
// is no invariant there to test, and every upstream file spends its assertions
// on behaviour instead. See `punycode/test/error-identity-static.js` for the
// same argument and a case where the missing assertion turned out to matter.
//
// It matters more here than anywhere else in the profile. The relationship is
// what lets a `Buffer` be handed to anything expecting bytes -- `ArrayBuffer
// .isView`, a `TextDecoder`, a Web stream, a typed-array constructor -- and
// `fs`, `stream`, `net` and `zlib` all move bytes through it. A compiled
// `Buffer` that is merely byte-shaped rather than genuinely a `Uint8Array`
// would pass a great many upstream tests before anyone noticed.
//
// On the demonstration, plainly: the two error-identity files were proved by
// mutating the source so that upstream passed and they failed. That is not
// available here. The invariant is structural -- `class Buffer extends
// Uint8Array` -- and the edits that break it in TypeScript break indexing and
// every method with it, so upstream fails too and the comparison says nothing.
// The failure this guards against lives at the compiled boundary, where a
// `Buffer` crosses as whatever the wrapper makes of it. So this is asserted
// because the invariant is real and unasserted, not because a source mutation
// showed it could break.
"use strict";

require("../common");

const assert = require("assert");

const samples = [
  ["Buffer.from(string)", Buffer.from("hello")],
  ["Buffer.from(array)", Buffer.from([1, 2, 3])],
  ["Buffer.alloc", Buffer.alloc(4)],
  ["Buffer.allocUnsafe", Buffer.allocUnsafe(4)],
  ["Buffer.concat", Buffer.concat([Buffer.from("a"), Buffer.from("b")])],
  ["buf.subarray", Buffer.from("hello").subarray(1, 3)],
];

for (const [made, buf] of samples) {
  assert.ok(buf instanceof Buffer, `${made} is not a Buffer`);
  // The relationship upstream never states.
  assert.ok(buf instanceof Uint8Array, `${made} is not a Uint8Array`);
  assert.ok(ArrayBuffer.isView(buf), `${made} is not an ArrayBuffer view`);
  assert.ok(buf.buffer instanceof ArrayBuffer, `${made} has no ArrayBuffer behind it`);
  assert.strictEqual(Buffer.isBuffer(buf), true, `${made} fails Buffer.isBuffer`);
  assert.strictEqual(buf.BYTES_PER_ELEMENT, 1, `${made} is not byte-sized`);
}

// The prototype chain itself, so a break is reported one link from where it is
// rather than as six failed samples.
assert.strictEqual(
  Object.getPrototypeOf(Buffer.prototype),
  Uint8Array.prototype,
  "Buffer.prototype no longer sits directly on Uint8Array.prototype",
);

// What the relationship is *for*: a Buffer has to work where bytes are wanted,
// through APIs that know nothing about Buffer. These are the paths `fs`,
// `stream` and `zlib` rely on.
{
  const buf = Buffer.from("hello");

  assert.deepStrictEqual(
    Array.from(new Uint8Array(buf)),
    [104, 101, 108, 108, 111],
    "a Buffer does not copy through the Uint8Array constructor",
  );
  assert.strictEqual(
    new TextDecoder().decode(buf),
    "hello",
    "a Buffer is not decodable as bytes",
  );
  assert.strictEqual(
    Object.prototype.toString.call(buf),
    "[object Uint8Array]",
    "a Buffer does not describe itself as a Uint8Array",
  );

  // A view over the same memory, not a copy: writing through one is visible in
  // the other. This is the property that makes zero-copy IO possible, and it is
  // the one a wrapper that quietly copies at the boundary would lose.
  const view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  view[0] = 74;
  assert.strictEqual(buf[0], 74, "a Buffer does not share memory with a view over it");
  assert.strictEqual(buf.toString(), "Jello", "the shared write is not visible as a string");
}
