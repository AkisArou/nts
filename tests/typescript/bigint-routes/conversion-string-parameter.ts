/*---
description: String conversion through a bigint parameter preserves all decimal digits and the bigint zero spelling.
features: [ts-bigint-route-conversions, ts-bigint, ts-conversions, ts-strings, ts-functions, ts-arrays]
---*/
// Route: a bigint parameter reaches String; node emits complete signed decimal digits and writes both zero inputs as 0.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
function stringifyBigint(value: bigint): string { return String(value); }
const expected: string[] = ["0", "0", "1", "-1", "2", "-2", "3", "-3", "7", "-7", "9223372036854775807", "-9223372036854775808", "18446744073709551616", "170141183460469231731687303715884105727", "-170141183460469231731687303715884105728", "9007199254740993"];
for (let index = 0; index < 16; index++) {
  const source: bigint = inputs[index];
  const result: string = stringifyBigint(source);
  assert.sameValue(result, expected[index]); assert.sameValue(typeof result, "string");
}
