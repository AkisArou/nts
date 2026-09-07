// Decoding a detached buffer answers `""`, and does not throw.
//
// Web IDL says getting a copy of a detached buffer source yields an empty byte
// sequence, so `new TextDecoder().decode(viewOverDetachedBuffer)` is `""`.
// Verified against node directly: a transferred `ArrayBuffer` has
// `byteLength === 0` and node decodes a view over it to the empty string.
//
// `util.TextDecoder` is re-exported from the web-platform lane rather than
// reimplemented, and until that lane's `a1332ed3` this path constructed a view
// over the detached buffer and threw `TypeError` instead. So `node:util`'s
// public surface threw where node returns `""`, and nothing on either side
// noticed: the `test-whatwg-encoding-*` files are not in `util`'s applicable
// set, so this profile had no test that could see it, and that lane had no
// reason to look at `node:util`.
//
// Asserted here rather than left to the other lane's own suite because the
// divergence was on *this* module's surface. A behaviour that reaches
// `require("util").TextDecoder` is this lane's to pin, wherever it is
// implemented.
"use strict";

require("../common");

const assert = require("assert");
const util = require("util");

// A transferred buffer is detached: zero-length, with the view still pointing at
// it. `structuredClone` with `transfer` is the portable way to get one.
const buffer = new ArrayBuffer(8);
const view = new Uint8Array(buffer);
structuredClone(buffer, { transfer: [buffer] });

assert.strictEqual(buffer.byteLength, 0, "the buffer was not detached, so this file tests nothing");
assert.strictEqual(view.byteLength, 0, "the view over a detached buffer is not empty");

assert.strictEqual(
  new util.TextDecoder().decode(view),
  "",
  "decoding a view over a detached buffer did not give the empty string",
);

// The same through the streaming option, which takes a different path inside.
assert.strictEqual(
  new util.TextDecoder("utf-8").decode(view, { stream: true }),
  "",
  "decoding a detached view with stream: true did not give the empty string",
);

// And a live buffer still decodes, so this cannot pass by every decode being "".
assert.strictEqual(
  new util.TextDecoder().decode(new util.TextEncoder().encode("café")),
  "café",
  "a live buffer no longer decodes",
);
