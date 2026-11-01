/*---
description: Spreading a bigint-array field preserves exact edge values and a copy independent of later source writes.
features: [ts-bigint-route-boundaries, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator, ts-objects, ts-spread]
---*/
// A bigint[] field is spread into a copy at sixteen magnitudes; node retains every bit and the copy survives a later source write.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const expectedSecond: bigint[] = [1n, 1n, 2n, 0n, 3n, -1n, 4n, -2n, 8n, -6n, 9223372036854775808n, -9223372036854775807n, 18446744073709551617n, 170141183460469231731687303715884105728n, -170141183460469231731687303715884105727n, 9007199254740994n];
const expectedThird: bigint[] = [0n, 0n, -1n, 1n, -2n, 2n, -3n, 3n, -7n, 7n, -9223372036854775807n, 9223372036854775808n, -18446744073709551616n, -170141183460469231731687303715884105727n, 170141183460469231731687303715884105728n, -9007199254740993n];
const expectedChanged: bigint[] = [2n, 2n, 3n, 1n, 4n, 0n, 5n, -1n, 9n, -5n, 9223372036854775809n, -9223372036854775806n, 18446744073709551618n, 170141183460469231731687303715884105729n, -170141183460469231731687303715884105726n, 9007199254740995n];
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const a: bigint = inputs[i]; const holder: { values: bigint[] } = { values: [a, a + 1n, -a] };
  const copied: bigint[] = [...holder.values];
  assert.sameValue(copied.length, 3);
  assert.sameValue(copied[0], expected[i]); assert.sameValue(typeof copied[0], "bigint");
  assert.sameValue(copied[1], expectedSecond[i]); assert.sameValue(typeof copied[1], "bigint");
  assert.sameValue(copied[2], expectedThird[i]); assert.sameValue(typeof copied[2], "bigint");
  holder.values[0] = a + 2n;
  assert.sameValue(holder.values[0], expectedChanged[i]); assert.sameValue(typeof holder.values[0], "bigint");
  assert.sameValue(copied[0], expected[i]); assert.sameValue(typeof copied[0], "bigint");
}
