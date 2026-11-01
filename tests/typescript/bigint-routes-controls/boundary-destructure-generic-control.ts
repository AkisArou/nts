/*---
description: Control for boundary-destructure-generic; local bigint constants preserve the same boundary results and exceptions.
features: [ts-bigint-route-boundaries, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator]
---*/
// Control: numeric selectors choose local bigint literals; direct operations replace the tested storage or generic route.
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const expectedSecond: bigint[] = [9n, 1n, 9n, 0n, 9n, -1n, 9n, -2n, 9n, -6n, 9n, -9223372036854775807n, 9n, 170141183460469231731687303715884105728n, 9n, 9007199254740994n];
const expectedThird: bigint[] = [-9n, 0n, -9n, 1n, -9n, 2n, -9n, 3n, -9n, 7n, -9n, 9223372036854775808n, -9n, -170141183460469231731687303715884105727n, -9n, -9007199254740993n];
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const first: bigint = i === 0 ? 0n : i === 1 ? -0n : i === 2 ? 1n : i === 3 ? -1n : i === 4 ? 2n : i === 5 ? -2n : i === 6 ? 3n : i === 7 ? -3n : i === 8 ? 7n : i === 9 ? -7n : i === 10 ? 9223372036854775807n : i === 11 ? -9223372036854775808n : i === 12 ? 18446744073709551616n : i === 13 ? 170141183460469231731687303715884105727n : i === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n;
  const second: bigint = i === 0 ? 9n : i === 1 ? 1n : i === 2 ? 9n : i === 3 ? 0n : i === 4 ? 9n : i === 5 ? -1n : i === 6 ? 9n : i === 7 ? -2n : i === 8 ? 9n : i === 9 ? -6n : i === 10 ? 9n : i === 11 ? -9223372036854775807n : i === 12 ? 9n : i === 13 ? 170141183460469231731687303715884105728n : i === 14 ? 9n : 9007199254740994n;
  const third: bigint = i === 0 ? -9n : i === 1 ? 0n : i === 2 ? -9n : i === 3 ? 1n : i === 4 ? -9n : i === 5 ? 2n : i === 6 ? -9n : i === 7 ? 3n : i === 8 ? -9n : i === 9 ? 7n : i === 10 ? -9n : i === 11 ? 9223372036854775808n : i === 12 ? -9n : i === 13 ? -170141183460469231731687303715884105727n : i === 14 ? -9n : -9007199254740993n;
  assert.sameValue(first, expected[i]); assert.sameValue(typeof first, "bigint");
  assert.sameValue(second, expectedSecond[i]); assert.sameValue(typeof second, "bigint");
  assert.sameValue(third, expectedThird[i]); assert.sameValue(typeof third, "bigint");
}
