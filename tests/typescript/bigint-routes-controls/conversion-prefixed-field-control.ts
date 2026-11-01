/*---
description: Control for conversion-prefixed-field; direct local constants retain the conversion, results and exception checks.
features: [ts-bigint-route-conversions, ts-bigint, ts-conversions, ts-strings, ts-arrays]
---*/
// Control: the same conversion is applied directly to local literal constants, with no typed carrier between operand and operation.
const expected: bigint[] = [0n, 1n, 255n, 9223372036854775807n, 9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, 170141183460469231731687303715884105728n, 0n, 7n, 18446744073709551615n, 18446744073709551616n, 0n, 5n, 9223372036854775807n, 18446744073709551616n];
for (let index = 0; index < 16; index++) {
  const source: string = index === 0 ? "0x0" : index === 1 ? " 0X1 " : index === 2 ? "\t0xff\n" : index === 3 ? "0x7fffffffffffffff" : index === 4 ? "0x8000000000000000" : index === 5 ? " 0x10000000000000000 " : index === 6 ? "0x7fffffffffffffffffffffffffffffff" : index === 7 ? "0x80000000000000000000000000000000" : index === 8 ? "0o0" : index === 9 ? "\n0O7 " : index === 10 ? "0o1777777777777777777777" : index === 11 ? "0o2000000000000000000000" : index === 12 ? "0b0" : index === 13 ? " 0B101 " : index === 14 ? "0b111111111111111111111111111111111111111111111111111111111111111" : "\t0b10000000000000000000000000000000000000000000000000000000000000000\n";
  const result: bigint = BigInt(source);
  assert.sameValue(result, expected[index]); assert.sameValue(typeof result, "bigint");
}
