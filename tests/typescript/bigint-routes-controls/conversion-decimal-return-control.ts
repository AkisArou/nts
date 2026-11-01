/*---
description: Control for conversion-decimal-return; direct local constants retain the conversion, results and exception checks.
features: [ts-bigint-route-conversions, ts-bigint, ts-conversions, ts-strings, ts-arrays]
---*/
// Control: the same conversion is applied directly to local literal constants, with no typed carrier between operand and operation.
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
let accepted = 0;
for (let index = 0; index < 16; index++) {
  const source: string = index === 0 ? "0" : index === 1 ? "-0" : index === 2 ? "+1" : index === 3 ? "-1" : index === 4 ? " 2 " : index === 5 ? "\t-2\n" : index === 6 ? "3" : index === 7 ? "-3" : index === 8 ? "\u00a07\u00a0" : index === 9 ? "\n-7\t" : index === 10 ? "9223372036854775807" : index === 11 ? "-9223372036854775808" : index === 12 ? " 18446744073709551616 " : index === 13 ? "170141183460469231731687303715884105727" : index === 14 ? "-170141183460469231731687303715884105728" : "+9007199254740993";
    const result: bigint = BigInt(source);
    assert.sameValue(result, expected[index]); assert.sameValue(typeof result, "bigint");
    accepted++;
}
assert.sameValue(accepted, 16);
