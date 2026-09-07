// Base64 and hex decode the string's *bytes*, not its characters.
//
// `Buffer.from(str, "base64")` does not see a JavaScript string. V8 writes one
// byte per UTF-16 code unit -- the low byte -- and node decodes that. So
// `U+0452` is indistinguishable from `"R"` (0x52), `U+013D` terminates the
// payload exactly as `"="` does, and a surrogate whose low byte is an ASCII hex
// digit counts as that digit.
//
// This profile indexed its tables by the whole code unit, which made every
// character above U+00FF a skip. And `byteLength` counted only alphabet
// characters, where node computes an upper bound from the length alone.
//
// A differential against node over 1,500 generated strings found all three:
// 1,406 divergences per encoding for `byteLength`, 659 per base64 flavour for
// the decode, and 12 for hex. None is reachable from node's own 76
// `test-buffer-*.js` files, which use well-formed ASCII input throughout --
// there is no reason to write a base64 test whose input is Cyrillic.
"use strict";

require("../common");

const assert = require("assert");

const C = String.fromCharCode;

// `byteLength` is a bound from the length, not the decoded size. It strips at
// most two trailing `=` and counts everything else, valid or not.
for (const [input, expected] of [
  ["A===", 1],
  ["AAAA", 3],
  ["AA", 1],
  ["", 0],
  ["=", 0],
  ["==", 0],
  [C(0x00fc).repeat(40), 30], // not one alphabet character in it
]) {
  for (const encoding of ["base64", "base64url"]) {
    assert.strictEqual(
      Buffer.byteLength(input, encoding),
      expected,
      `byteLength(${JSON.stringify(input)}, ${encoding})`,
    );
  }
}

// The low byte is the character, for both decoders.
for (const [wide, ascii, encoding] of [
  [C(0x0452), "R", "base64"],           // 0x52
  [C(0x0142), "B", "base64"],           // 0x42
  [C(0x0452, 0x0452, 0x0452, 0x0452), "RRRR", "base64"],
  ["a" + C(0x0452) + "cd", "aRcd", "base64"],
  ["4" + C(0x0146), "4F", "hex"],       // 0x46
  [C(0x0141) + C(0x0142), "AB", "hex"], // 0x41 0x42
]) {
  assert.deepStrictEqual(
    [...Buffer.from(wide, encoding)],
    [...Buffer.from(ascii, encoding)],
    `${encoding}: a wide code unit did not decode as its low byte`,
  );
}

// `=` terminates on the low byte too, so U+013D ends the payload.
assert.deepStrictEqual(
  [...Buffer.from("ab" + C(0x013d) + "cd", "base64")],
  [...Buffer.from("ab=cd", "base64")],
  "a low byte of 0x3d did not terminate the base64 payload",
);

// And the forgiving path still skips ASCII that is not in the alphabet.
assert.deepStrictEqual([...Buffer.from("a$b$c$d", "base64")], [...Buffer.from("abcd", "base64")]);
assert.deepStrictEqual([...Buffer.from("ab cd", "base64")], [...Buffer.from("abcd", "base64")]);
