/*---
description: Destructuring a bigint-constrained readonly return preserves edge values and defaults for absent elements.
features: [ts-bigint-route-boundaries, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator, ts-generics, ts-generic-constraints, ts-readonly, ts-functions, ts-destructuring]
---*/
// A generic readonly bigint array reaches destructuring; node keeps present edge values and applies bigint defaults only to absent slots.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
function carried<T extends bigint>(values: readonly T[]): readonly T[] { return values; }
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const expectedSecond: bigint[] = [9n, 1n, 9n, 0n, 9n, -1n, 9n, -2n, 9n, -6n, 9n, -9223372036854775807n, 9n, 170141183460469231731687303715884105728n, 9n, 9007199254740994n];
const expectedThird: bigint[] = [-9n, 0n, -9n, 1n, -9n, 2n, -9n, 3n, -9n, 7n, -9n, 9223372036854775808n, -9n, -170141183460469231731687303715884105727n, -9n, -9007199254740993n];
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const a: bigint = inputs[i]; const source: bigint[] = i % 2 === 0 ? [a] : [a, a + 1n, -a];
  const [first, second = 9n, third = -9n] = carried(source);
  assert.sameValue(first, expected[i]); assert.sameValue(typeof first, "bigint");
  assert.sameValue(second, expectedSecond[i]); assert.sameValue(typeof second, "bigint");
  assert.sameValue(third, expectedThird[i]); assert.sameValue(typeof third, "bigint");
}
