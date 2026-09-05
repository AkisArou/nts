"use strict";

// Every supported assertion from pinned upstream
// `parallel/test-string-decoder.js`. The omitted blocks call the class as a
// function on an arbitrary receiver, dispatch through `instance.__proto__`, or
// allocate half a GiB solely to probe V8's host-specific maximum string size.
const common = require("../common");
const assert = require("assert");
const { StringDecoder } = require("string_decoder");

let decoder = new StringDecoder();
assert.strictEqual(decoder.encoding, "utf8");

test("utf-8", Buffer.from("$", "utf-8"), "$");
test("utf-8", Buffer.from("¢", "utf-8"), "¢");
test("utf-8", Buffer.from("€", "utf-8"), "€");
test("utf-8", Buffer.from("𤭢", "utf-8"), "𤭢");
test(
  "utf-8",
  Buffer.from([0xcb, 0xa4, 0x64, 0xe1, 0x8b, 0xa4, 0x30, 0xe3, 0x81, 0x85]),
  "\u02e4\u0064\u12e4\u0030\u3045",
);

// Invalid UTF-8 cases with historically chunk-sensitive replacement output.
test("utf-8", Buffer.from("C9B5A941", "hex"), "\u0275\ufffdA");
test("utf-8", Buffer.from("E2", "hex"), "\ufffd");
test("utf-8", Buffer.from("E241", "hex"), "\ufffdA");
test("utf-8", Buffer.from("CCCCB8", "hex"), "\ufffd\u0338");
test("utf-8", Buffer.from("F0B841", "hex"), "\ufffdA");
test("utf-8", Buffer.from("F1CCB8", "hex"), "\ufffd\u0338");
test("utf-8", Buffer.from("F0FB00", "hex"), "\ufffd\ufffd\0");
test("utf-8", Buffer.from("CCE2B8B8", "hex"), "\ufffd\u2e38");
test("utf-8", Buffer.from("E2B8CCB8", "hex"), "\ufffd\u0338");
test("utf-8", Buffer.from("E2FBCC01", "hex"), "\ufffd\ufffd\ufffd\u0001");
test("utf-8", Buffer.from("CCB8CDB9", "hex"), "\u0338\u0379");
test("utf-8", Buffer.from("EDA0B5EDB08D", "hex"), "\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd");

test("ucs2", Buffer.from("ababc", "ucs2"), "ababc");
test("utf16le", Buffer.from("3DD84DDC", "hex"), "\ud83d\udc4d");

decoder = new StringDecoder("utf8");
assert.strictEqual(decoder.write(Buffer.from("E1", "hex")), "");
assert(decoder.lastChar.equals(new Uint8Array([0xe1, 0, 0, 0])));
assert.strictEqual(decoder.lastNeed, 2);
assert.strictEqual(decoder.lastTotal, 3);
assert.strictEqual(decoder.end(), "\ufffd");

const arrayBufferViewText = "String for ArrayBufferView tests\n";
const inputBuffer = Buffer.from(arrayBufferViewText.repeat(8), "utf8");
for (const view of common.getArrayBufferViews(inputBuffer)) {
  assert.strictEqual(decoder.write(view), inputBuffer.toString("utf8"));
  assert.strictEqual(decoder.end(), "");
}

decoder = new StringDecoder("utf8");
assert.strictEqual(decoder.write(Buffer.from("E18B", "hex")), "");
assert.strictEqual(decoder.end(), "\ufffd");

decoder = new StringDecoder("utf8");
assert.strictEqual(decoder.write(Buffer.from("\ufffd")), "\ufffd");
assert.strictEqual(decoder.end(), "");

decoder = new StringDecoder("utf8");
assert.strictEqual(decoder.write(Buffer.from("\ufffd\ufffd\ufffd")), "\ufffd\ufffd\ufffd");
assert.strictEqual(decoder.end(), "");

decoder = new StringDecoder("utf8");
assert.strictEqual(decoder.write(Buffer.from("EFBFBDE2", "hex")), "\ufffd");
assert.strictEqual(decoder.end(), "\ufffd");

decoder = new StringDecoder("utf8");
assert.strictEqual(decoder.write(Buffer.from("F1", "hex")), "");
assert.strictEqual(decoder.write(Buffer.from("41F2", "hex")), "\ufffdA");
assert.strictEqual(decoder.end(), "\ufffd");

decoder = new StringDecoder("utf8");
assert.strictEqual(decoder.text(Buffer.from([0x41]), 2), "");

decoder = new StringDecoder("utf16le");
assert.strictEqual(decoder.write(Buffer.from("3DD8", "hex")), "");
assert.strictEqual(decoder.write(Buffer.from("4D", "hex")), "");
assert.strictEqual(decoder.write(Buffer.from("DC", "hex")), "\ud83d\udc4d");
assert.strictEqual(decoder.end(), "");

decoder = new StringDecoder("utf16le");
assert.strictEqual(decoder.write(Buffer.from("3DD8", "hex")), "");
assert.strictEqual(decoder.end(), "\ud83d");

decoder = new StringDecoder("utf16le");
assert.strictEqual(decoder.write(Buffer.from("3DD8", "hex")), "");
assert.strictEqual(decoder.write(Buffer.from("4D", "hex")), "");
assert.strictEqual(decoder.end(), "\ud83d");

decoder = new StringDecoder("utf16le");
assert.strictEqual(decoder.write(Buffer.from("3DD84D", "hex")), "\ud83d");
assert.strictEqual(decoder.end(), "");

// Unaligned UTF-16 access regression.
decoder = new StringDecoder("utf16le");
assert.strictEqual(decoder.write(Buffer.alloc(1)), "");
assert.strictEqual(decoder.write(Buffer.alloc(20)), "\0".repeat(10));
assert.strictEqual(decoder.write(Buffer.alloc(48)), "\0".repeat(24));
assert.strictEqual(decoder.end(), "");

// Incomplete multi-byte replacement-count regressions.
decoder = new StringDecoder("utf8");
assert.strictEqual(decoder.write(Buffer.from("f69b", "hex")), "");
assert.strictEqual(decoder.write(Buffer.from("d1", "hex")), "\ufffd\ufffd");
assert.strictEqual(decoder.end(), "\ufffd");
assert.strictEqual(decoder.write(Buffer.from("f4", "hex")), "");
assert.strictEqual(decoder.write(Buffer.from("bde5", "hex")), "\ufffd\ufffd");
assert.strictEqual(decoder.end(), "\ufffd");

assert.throws(() => new StringDecoder(1), {
  code: "ERR_UNKNOWN_ENCODING",
  name: "TypeError",
  message: "Unknown encoding: 1",
});
assert.throws(() => new StringDecoder("test"), {
  code: "ERR_UNKNOWN_ENCODING",
  name: "TypeError",
  message: "Unknown encoding: test",
});
assert.throws(() => new StringDecoder("utf8").write(null), {
  code: "ERR_INVALID_ARG_TYPE",
  name: "TypeError",
  message:
    'The "buf" argument must be an instance of Buffer, TypedArray, or DataView. Received null',
});

assert.strictEqual(new StringDecoder("utf8").write("already decoded"), "already decoded");

/** Exercise every possible non-empty chunking of one input buffer. */
function test(encoding, input, expected) {
  for (const sequence of writeSequences(input.length)) {
    const candidate = new StringDecoder(encoding);
    let output = "";
    for (const write of sequence) {
      output += candidate.write(input.slice(write[0], write[1]));
    }
    output += candidate.end();
    assert.strictEqual(output, expected);
  }
}

function writeSequences(length, start = 0, sequence = []) {
  if (start === length) return [sequence];
  let sequences = [];
  for (let end = length; end > start; end--) {
    const next = sequence.concat([[start, end]]);
    sequences = sequences.concat(writeSequences(length, end, next));
  }
  return sequences;
}
