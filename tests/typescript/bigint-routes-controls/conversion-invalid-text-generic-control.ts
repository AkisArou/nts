/*---
description: Control for conversion-invalid-text-generic; direct local constants retain the conversion, results and exception checks.
features: [ts-bigint-route-conversions, ts-bigint, ts-conversions, ts-strings, ts-errors, ts-arrays, ts-arrow-functions]
---*/
// Control: the same conversion is applied directly to local literal constants, with no typed carrier between operand and operation.
const expected: bigint[] = [0n, 0n, 0n, 0n, 7n, -9n, 16n, 42n];
let accepted = 0, rejected = 0;
for (let index = 0; index < 21; index++) {
  const source: string = index === 0 ? "" : index === 1 ? " " : index === 2 ? "\t\n" : index === 3 ? "-0" : index === 4 ? "+7" : index === 5 ? "-9" : index === 6 ? "0x10" : index === 7 ? " 42 " : index === 8 ? "1_000" : index === 9 ? "1e3" : index === 10 ? "1.0" : index === 11 ? "12n" : index === 12 ? "Infinity" : index === 13 ? "NaN" : index === 14 ? "--1" : index === 15 ? "0x" : index === 16 ? "-0x1" : index === 17 ? "+0x1" : index === 18 ? "0b2" : index === 19 ? "0o8" : "1 2";
  if (index < 8) {
    const result: bigint = BigInt(source);
    assert.sameValue(result, expected[index]); assert.sameValue(typeof result, "bigint");
    accepted++;
  } else {
    assert.throws(SyntaxError, () => {
      const source: string = index === 0 ? "" : index === 1 ? " " : index === 2 ? "\t\n" : index === 3 ? "-0" : index === 4 ? "+7" : index === 5 ? "-9" : index === 6 ? "0x10" : index === 7 ? " 42 " : index === 8 ? "1_000" : index === 9 ? "1e3" : index === 10 ? "1.0" : index === 11 ? "12n" : index === 12 ? "Infinity" : index === 13 ? "NaN" : index === 14 ? "--1" : index === 15 ? "0x" : index === 16 ? "-0x1" : index === 17 ? "+0x1" : index === 18 ? "0b2" : index === 19 ? "0o8" : "1 2";
      BigInt(source);
    }); rejected++;
  }
}
assert.sameValue(accepted, 8); assert.sameValue(rejected, 13);
