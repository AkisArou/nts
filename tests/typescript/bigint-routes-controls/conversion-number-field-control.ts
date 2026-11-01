/*---
description: Control for conversion-number-field; direct local constants retain the conversion, results and exception checks.
features: [ts-bigint-route-conversions, ts-bigint, ts-conversions, ts-numbers, ts-arrays]
---*/
// Control: the same conversion is applied directly to local literal constants, with no typed carrier between operand and operation.
const expected: number[] = [0.0, 0, 1.0, -1.0, 2.0, -2.0, 3.0, -3.0, 7.0, -7.0, 9.223372036854776e+18, -9.223372036854776e+18, 1.8446744073709552e+19, 1.7014118346046923e+38, -1.7014118346046923e+38, 9007199254740992.0, 9007199254740996.0, -9007199254740992.0, -9007199254740996.0, 1.8446744073709552e+19];
for (let index = 0; index < 20; index++) {
  const source: bigint = index === 0 ? 0n : index === 1 ? -0n : index === 2 ? 1n : index === 3 ? -1n : index === 4 ? 2n : index === 5 ? -2n : index === 6 ? 3n : index === 7 ? -3n : index === 8 ? 7n : index === 9 ? -7n : index === 10 ? 9223372036854775807n : index === 11 ? -9223372036854775808n : index === 12 ? 18446744073709551616n : index === 13 ? 170141183460469231731687303715884105727n : index === 14 ? -170141183460469231731687303715884105728n : index === 15 ? 9007199254740993n : index === 16 ? 9007199254740995n : index === 17 ? -9007199254740993n : index === 18 ? -9007199254740995n : 18446744073709551615n;
  const result: number = Number(source);
  assert.sameValue(result, expected[index]); assert.sameValue(typeof result, "number");
}
