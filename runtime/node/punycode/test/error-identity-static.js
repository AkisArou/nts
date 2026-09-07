// The error *identity* upstream's own test does not check.
//
// `parallel/test-punycode.js` asserts these three throws by regex against the
// error's string form -- `/^RangeError: Invalid input$/` -- which is built from
// `name` and `message`. That passes for anything whose `name` is "RangeError",
// including a plain `Error` with the name assigned. Nothing upstream asks
// whether the thrown value *is* a RangeError.
//
// On node that gap costs nothing, because `throw new RangeError(...)` cannot
// produce something that fails `instanceof RangeError`. On a compiled artifact
// it can: the class an object is laid out as decides the set `instanceof`
// accepts, and a compiler that widens an allocation to a declared type without
// carrying the hierarchy across produces exactly this -- an error with the
// right name, the right message, the right string form, and `instanceof Error`
// false. The compiler lane came within one fixture of shipping that today.
//
// So this asserts what node's suite leaves free. Across the 22 modules in this
// profile, 52 of 1,890 upstream test files assert a constructor or `instanceof`
// at all, and six modules -- `punycode` among them -- have none. That is not a
// flaw in node's tests. It is what an oracle looks like when the invariant it
// would be testing cannot fail in the implementation it was written against.
"use strict";

require("../common");

const assert = require("assert");
const punycode = require("punycode");

// The same three inputs upstream throws on, asked a different question.
for (const input of [" ", "α-", "あ"]) {
  let thrown;
  try {
    punycode.decode(input);
  } catch (error) {
    thrown = error;
  }

  assert.notStrictEqual(thrown, undefined, `decode(${JSON.stringify(input)}) did not throw`);
  assert.ok(
    thrown instanceof RangeError,
    `decode(${JSON.stringify(input)}) threw ${thrown?.name} that is not a RangeError`,
  );
  // Asserted separately rather than left to follow from the line above: a
  // hierarchy can be broken at either link, and `instanceof RangeError` holding
  // while `instanceof Error` does not is precisely the shape of a compiler that
  // records one relation and walks another.
  assert.ok(thrown instanceof Error, "a RangeError that is not an Error");
  assert.strictEqual(thrown.name, "RangeError");
  assert.strictEqual(Object.getPrototypeOf(thrown), RangeError.prototype);
}

// `ucs2.encode` rejects a non-integer code point the same way, so the identity
// is checked on a second throw site rather than only on `decode`'s.
{
  let thrown;
  try {
    punycode.ucs2.encode([NaN]);
  } catch (error) {
    thrown = error;
  }
  assert.notStrictEqual(thrown, undefined, "ucs2.encode([NaN]) did not throw");
  assert.ok(thrown instanceof RangeError, "ucs2.encode([NaN]) threw a non-RangeError");
  assert.ok(thrown instanceof Error, "a RangeError that is not an Error");
}
