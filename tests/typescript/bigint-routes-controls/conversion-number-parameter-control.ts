/*---
description: Control for conversion-number-parameter; direct local constants retain the conversion, results and exception checks.
features: [ts-bigint-route-conversions, ts-bigint, ts-conversions, ts-numbers, ts-errors, ts-arrays, ts-arrow-functions]
---*/
// Control: the same conversion is applied directly to local literal constants, with no typed carrier between operand and operation.
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 9007199254740992n, 9007199254740994n, 9223372036854775808n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105728n, -170141183460469231731687303715884105728n];
let accepted = 0, rejected = 0;
for (let index = 0; index < 20; index++) {
  const source: number = index === 0 ? 0 : index === 1 ? -0 : index === 2 ? 1 : index === 3 ? -1 : index === 4 ? 2 : index === 5 ? -2 : index === 6 ? 3 : index === 7 ? -3 : index === 8 ? 9007199254740992 : index === 9 ? 9007199254740994 : index === 10 ? 9223372036854775807 : index === 11 ? -9223372036854775808 : index === 12 ? 18446744073709551616 : index === 13 ? 170141183460469231731687303715884105727 : index === 14 ? -170141183460469231731687303715884105728 : index === 15 ? 0.5 : index === 16 ? -1.5 : index === 17 ? NaN : index === 18 ? Infinity : -Infinity;
  if (index < 15) {
    const result: bigint = BigInt(source);
    assert.sameValue(result, expected[index]); assert.sameValue(typeof result, "bigint");
    accepted++;
  } else {
    assert.throws(RangeError, () => {
      const source: number = index === 0 ? 0 : index === 1 ? -0 : index === 2 ? 1 : index === 3 ? -1 : index === 4 ? 2 : index === 5 ? -2 : index === 6 ? 3 : index === 7 ? -3 : index === 8 ? 9007199254740992 : index === 9 ? 9007199254740994 : index === 10 ? 9223372036854775807 : index === 11 ? -9223372036854775808 : index === 12 ? 18446744073709551616 : index === 13 ? 170141183460469231731687303715884105727 : index === 14 ? -170141183460469231731687303715884105728 : index === 15 ? 0.5 : index === 16 ? -1.5 : index === 17 ? NaN : index === 18 ? Infinity : -Infinity;
      BigInt(source);
    }); rejected++;
  }
}
assert.sameValue(accepted, 15); assert.sameValue(rejected, 5);
