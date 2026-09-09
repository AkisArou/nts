// `charLengthAt` and `charLengthLeft`, against node's own answers.
//
// The compiled `readline` publishes seven names and **none of them is on node's
// public surface** -- they are the `internal/readline/utils` helpers, which is
// where node's own `lib/` reaches them. The module records zero compiled
// passes, because every upstream `test-readline-*.js` attaches to a stream.
//
// Two of the three functions answer exactly what node answers, including the
// cases the function exists for:
//
//     charLengthAt("abc", 0)      1     ours and node
//     charLengthAt("<emoji>b", 0) 2     a surrogate pair counted as one char
//     charLengthAt("<combining>", 0) 1  a combining mark
//     charLengthLeft("abc", 3)    1
//     charLengthLeft("<emoji>", 2) 2    stepping back over a pair
//     charLengthLeft("abc", 0)    0     at the start there is nothing to the left
//
// Checked against `node --expose-internals -e 'require("internal/readline/utils")'`
// on 24.20.0 before this was written, rather than asserted from the spec. The
// surrogate rows are the point: an implementation that counts UTF-16 code units
// passes every ASCII row and fails those two.
//
// # `reverseString` is the third, and it is not here
//
// Node declares `reverseString(line, from = '\r', to = '\r')` with
// `.length === 1`. `runtime/node/readline/src/utils.ts:91` declares exactly the
// same defaults -- the source is right -- and the wrapper publishes it as
// requiring three arguments, so `reverseString("abc")` raises
// `the compiled function requires 3 arguments` where node returns `"abc"`.
//
// That is `blockers/optional-parameter-at-the-wrapper`, already filed, and it
// is not asserted here: a test that fails for a filed reason adds a row and no
// information. When the wrapper carries optionals, this file should grow the
// two `reverseString` rows.
"use strict";

require("../common");

const assert = require("assert");
const { charLengthAt, charLengthLeft } = require("internal/readline/utils");

assert.strictEqual(typeof charLengthAt, "function", "charLengthAt is missing");
assert.strictEqual(typeof charLengthLeft, "function", "charLengthLeft is missing");

// One code unit, one character.
assert.strictEqual(charLengthAt("abc", 0), 1, "charLengthAt over ASCII is not 1");
assert.strictEqual(charLengthAt("abc", 2), 1, "charLengthAt at the last index is not 1");

// A surrogate pair is two code units and one character. An implementation
// counting code units passes everything above and fails here.
assert.strictEqual(
  charLengthAt("\u{1F600}b", 0),
  2,
  "charLengthAt did not count a surrogate pair as one character",
);
assert.strictEqual(
  charLengthAt("\u{1F600}b", 2),
  1,
  "charLengthAt after a surrogate pair is not 1",
);

// A combining mark is one code unit on its own.
assert.strictEqual(charLengthAt("́", 0), 1, "charLengthAt over a combining mark is not 1");

// Stepping backwards.
assert.strictEqual(charLengthLeft("abc", 3), 1, "charLengthLeft from the end is not 1");
assert.strictEqual(
  charLengthLeft("\u{1F600}", 2),
  2,
  "charLengthLeft did not step back over a surrogate pair",
);

// At the start there is nothing to the left, and the answer is 0 rather than a
// throw or a 1.
assert.strictEqual(charLengthLeft("abc", 0), 0, "charLengthLeft at index 0 is not 0");
