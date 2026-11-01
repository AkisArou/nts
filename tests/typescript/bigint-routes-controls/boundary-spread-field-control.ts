/*---
description: Control for boundary-spread-field; local bigint constants preserve the same boundary results and exceptions.
features: [ts-bigint-route-boundaries, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator, ts-numbers]
---*/
// Control: numeric selectors choose local bigint literals; direct operations replace the tested storage or generic route.
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const expectedSecond: bigint[] = [1n, 1n, 2n, 0n, 3n, -1n, 4n, -2n, 8n, -6n, 9223372036854775808n, -9223372036854775807n, 18446744073709551617n, 170141183460469231731687303715884105728n, -170141183460469231731687303715884105727n, 9007199254740994n];
const expectedThird: bigint[] = [0n, 0n, -1n, 1n, -2n, 2n, -3n, 3n, -7n, 7n, -9223372036854775807n, 9223372036854775808n, -18446744073709551616n, -170141183460469231731687303715884105727n, 170141183460469231731687303715884105728n, -9007199254740993n];
const expectedChanged: bigint[] = [2n, 2n, 3n, 1n, 4n, 0n, 5n, -1n, 9n, -5n, 9223372036854775809n, -9223372036854775806n, 18446744073709551618n, 170141183460469231731687303715884105729n, -170141183460469231731687303715884105726n, 9007199254740995n];
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const first: bigint = i === 0 ? 0n : i === 1 ? -0n : i === 2 ? 1n : i === 3 ? -1n : i === 4 ? 2n : i === 5 ? -2n : i === 6 ? 3n : i === 7 ? -3n : i === 8 ? 7n : i === 9 ? -7n : i === 10 ? 9223372036854775807n : i === 11 ? -9223372036854775808n : i === 12 ? 18446744073709551616n : i === 13 ? 170141183460469231731687303715884105727n : i === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n;
  const second: bigint = i === 0 ? 1n : i === 1 ? 1n : i === 2 ? 2n : i === 3 ? 0n : i === 4 ? 3n : i === 5 ? -1n : i === 6 ? 4n : i === 7 ? -2n : i === 8 ? 8n : i === 9 ? -6n : i === 10 ? 9223372036854775808n : i === 11 ? -9223372036854775807n : i === 12 ? 18446744073709551617n : i === 13 ? 170141183460469231731687303715884105728n : i === 14 ? -170141183460469231731687303715884105727n : 9007199254740994n;
  const third: bigint = i === 0 ? 0n : i === 1 ? 0n : i === 2 ? -1n : i === 3 ? 1n : i === 4 ? -2n : i === 5 ? 2n : i === 6 ? -3n : i === 7 ? 3n : i === 8 ? -7n : i === 9 ? 7n : i === 10 ? -9223372036854775807n : i === 11 ? 9223372036854775808n : i === 12 ? -18446744073709551616n : i === 13 ? -170141183460469231731687303715884105727n : i === 14 ? 170141183460469231731687303715884105728n : -9007199254740993n;
  const copiedLength: number = 3; assert.sameValue(copiedLength, 3);
  assert.sameValue(first, expected[i]); assert.sameValue(typeof first, "bigint");
  assert.sameValue(second, expectedSecond[i]); assert.sameValue(typeof second, "bigint");
  assert.sameValue(third, expectedThird[i]); assert.sameValue(typeof third, "bigint");
  const changed: bigint = i === 0 ? 2n : i === 1 ? 2n : i === 2 ? 3n : i === 3 ? 1n : i === 4 ? 4n : i === 5 ? 0n : i === 6 ? 5n : i === 7 ? -1n : i === 8 ? 9n : i === 9 ? -5n : i === 10 ? 9223372036854775809n : i === 11 ? -9223372036854775806n : i === 12 ? 18446744073709551618n : i === 13 ? 170141183460469231731687303715884105729n : i === 14 ? -170141183460469231731687303715884105726n : 9007199254740995n;
  assert.sameValue(changed, expectedChanged[i]); assert.sameValue(typeof changed, "bigint");
  assert.sameValue(first, expected[i]); assert.sameValue(typeof first, "bigint");
}
