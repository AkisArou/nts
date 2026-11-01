/*---
description: A generic parser with a bigint return accepts integer text and throws SyntaxError for every invalid grammar without losing valid results.
features: [ts-bigint-route-conversions, ts-bigint, ts-conversions, ts-strings, ts-functions, ts-generics, ts-generic-constraints, ts-errors, ts-arrays, ts-arrow-functions]
---*/
// Route: a generic text parameter feeds a bigint return; node accepts blank integer text but rejects fractional, separator, exponent and malformed-prefix text.
const inputs: string[] = ["", " ", "\t\n", "-0", "+7", "-9", "0x10", " 42 ", "1_000", "1e3", "1.0", "12n", "Infinity", "NaN", "--1", "0x", "-0x1", "+0x1", "0b2", "0o8", "1 2"];
function parseText<T extends string>(value: T): bigint { return BigInt(value); }
const expected: bigint[] = [0n, 0n, 0n, 0n, 7n, -9n, 16n, 42n];
let accepted = 0, rejected = 0;
for (let index = 0; index < 21; index++) {
  const source: string = inputs[index];
  if (index < 8) {
    const result: bigint = parseText(source);
    assert.sameValue(result, expected[index]); assert.sameValue(typeof result, "bigint");
    accepted++;
  } else {
    assert.throws(SyntaxError, () => { parseText(source); }); rejected++;
  }
}
assert.sameValue(accepted, 8); assert.sameValue(rejected, 13);
