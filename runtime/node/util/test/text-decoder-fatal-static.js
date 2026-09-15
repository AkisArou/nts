// A `fatal` TextDecoder's error carries node's code, not just its type.
//
// `util.TextDecoder` is `runtime/web-platform/src/core/encoding.ts` re-exported, and
// that file threw `new TypeError("Invalid UTF-8")`. The Encoding standard asks only
// for a `TypeError`, so it was conformant and WPT's encoding tests pass either way
// -- the one that covers this asserts the constructor and nothing more.
//
// But node attaches `ERR_ENCODING_INVALID_ENCODED_DATA`, and that is not decoration:
// the same class throws a bare `TypeError` for a bad argument, so without the code a
// caller cannot tell "your bytes were invalid" from "your call was". The code is the
// only thing that separates them, which is why node has it.
//
// The message follows node's too, naming the encoding that failed. This decoder
// implements three, and "Invalid UTF-8" leaves a reader to work out which one was in
// play.
//
// Found by the differential rather than by a test: nothing here compared `.code`,
// because nothing here called `TextDecoder` at all until `corpus-reach.mjs` reported
// it as published and uncalled.
"use strict";

const assert = require("assert");
const util = require("util");

// Bytes that are invalid UTF-8: a lone continuation byte, then a truncated lead.
const invalid = new Uint8Array([0x80, 0xc3]);

const fatal = new util.TextDecoder("utf-8", { fatal: true });
assert.throws(
  () => fatal.decode(invalid),
  (error) => {
    assert.ok(error instanceof TypeError, "the standard asks for a TypeError, and it stays one");
    assert.strictEqual(error.name, "TypeError");
    assert.strictEqual(error.code, "ERR_ENCODING_INVALID_ENCODED_DATA");
    assert.strictEqual(error.message, "The encoded data was not valid for encoding utf-8");
    return true;
  },
);

// The encoding is named from the decoder's own label, so utf-16 says so. An odd
// number of bytes cannot form a code unit, which is that decoder's invalid input.
const fatal16 = new util.TextDecoder("utf-16le", { fatal: true });
assert.throws(
  () => fatal16.decode(new Uint8Array([0x41])),
  (error) => {
    assert.strictEqual(error.code, "ERR_ENCODING_INVALID_ENCODED_DATA");
    assert.strictEqual(error.message, "The encoded data was not valid for encoding utf-16le");
    return true;
  },
);

// Not fatal: the same bytes substitute U+FFFD and throw nothing. The control that
// says the code above is reached by invalid data and not by every decode.
const lenient = new util.TextDecoder("utf-8");
assert.strictEqual(lenient.decode(invalid), "��");

// And an argument error from the same class is still distinguishable, which is the
// whole point of the code.
assert.throws(() => new util.TextDecoder("not-an-encoding"), RangeError);
assert.throws(
  () => fatal.decode("a string is not a buffer source"),
  (error) => {
    assert.ok(error instanceof TypeError, "a bad argument is a TypeError too");
    assert.notStrictEqual(
      error.code, "ERR_ENCODING_INVALID_ENCODED_DATA",
      "but it must not wear the invalid-data code",
    );
    return true;
  },
);
