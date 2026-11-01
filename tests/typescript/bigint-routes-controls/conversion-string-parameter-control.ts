/*---
description: Control for conversion-string-parameter; direct local constants retain the conversion, results and exception checks.
features: [ts-bigint-route-conversions, ts-bigint, ts-conversions, ts-strings, ts-arrays]
---*/
// Control: the same conversion is applied directly to local literal constants, with no typed carrier between operand and operation.
const expected: string[] = ["0", "0", "1", "-1", "2", "-2", "3", "-3", "7", "-7", "9223372036854775807", "-9223372036854775808", "18446744073709551616", "170141183460469231731687303715884105727", "-170141183460469231731687303715884105728", "9007199254740993"];
for (let index = 0; index < 16; index++) {
  const source: bigint = index === 0 ? 0n : index === 1 ? -0n : index === 2 ? 1n : index === 3 ? -1n : index === 4 ? 2n : index === 5 ? -2n : index === 6 ? 3n : index === 7 ? -3n : index === 8 ? 7n : index === 9 ? -7n : index === 10 ? 9223372036854775807n : index === 11 ? -9223372036854775808n : index === 12 ? 18446744073709551616n : index === 13 ? 170141183460469231731687303715884105727n : index === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n;
  const result: string = String(source);
  assert.sameValue(result, expected[index]); assert.sameValue(typeof result, "string");
}
