/*---
description: Number conversion of a bigint field rounds at double precision while preserving signs and the numeric result kind.
features: [ts-bigint-route-conversions, ts-bigint, ts-conversions, ts-numbers, ts-interfaces, ts-objects, ts-arrays]
---*/
// Route: a bigint field carries exact 64-bit and 128-bit edges into Number; node rounds ties and returns a number, including positive zero for -0n.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n, 9007199254740995n, -9007199254740993n, -9007199254740995n, 18446744073709551615n];
interface BigintNumberField { value: bigint; }
const holder: BigintNumberField = { value: 0n };
const expected: number[] = [0.0, 0, 1.0, -1.0, 2.0, -2.0, 3.0, -3.0, 7.0, -7.0, 9.223372036854776e+18, -9.223372036854776e+18, 1.8446744073709552e+19, 1.7014118346046923e+38, -1.7014118346046923e+38, 9007199254740992.0, 9007199254740996.0, -9007199254740992.0, -9007199254740996.0, 1.8446744073709552e+19];
for (let index = 0; index < 20; index++) {
  const source: bigint = inputs[index];
  const result: number = (holder.value = source, Number(holder.value));
  assert.sameValue(result, expected[index]); assert.sameValue(typeof result, "number");
}
