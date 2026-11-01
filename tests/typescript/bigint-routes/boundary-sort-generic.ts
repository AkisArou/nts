/*---
description: A bigint-constrained array sort preserves exact signed edge order with a bigint sign converted to number.
features: [ts-bigint-route-boundaries, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator, ts-generics, ts-generic-constraints, ts-functions, ts-conversions, ts-numbers]
---*/
// A generic bigint array reaches sort with a number-sign comparator; node retains the exact stable value order over all sixteen rotations.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
function compare(left: bigint, right: bigint): number { const sign: bigint = left < right ? -1n : left > right ? 1n : 0n; return Number(sign); }
function ordered<T extends bigint>(values: T[]): T[] { return values.sort(compare); }
const expected: bigint[] = [-170141183460469231731687303715884105728n, -9223372036854775808n, -7n, -3n, -2n, -1n, 0n, 0n, 1n, 2n, 3n, 7n, 9007199254740993n, 9223372036854775807n, 18446744073709551616n, 170141183460469231731687303715884105727n];
const expectedSigns: number[] = [0, 0, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, -1, 1, -1, 0, 0, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, -1, 1, -1, 1, 1, 0, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1, -1, 1, -1, -1, -1, -1, 0, -1, 1, -1, 1, -1, 1, -1, 1, -1, -1, 1, -1, 1, 1, 1, 1, 0, 1, -1, 1, -1, 1, -1, 1, -1, -1, 1, -1, -1, -1, -1, -1, -1, 0, -1, 1, -1, 1, -1, 1, -1, -1, 1, -1, 1, 1, 1, 1, 1, 1, 0, 1, -1, 1, -1, 1, -1, -1, 1, -1, -1, -1, -1, -1, -1, -1, -1, 0, -1, 1, -1, 1, -1, -1, 1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, -1, 1, -1, -1, 1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 0, -1, 1, -1, -1, 1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, -1, -1, 1, 1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 0, -1, -1, 1, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 0, -1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, 1, -1, -1, 1, 0];
let checked = 0;
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) for (const j of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const sign: number = compare(inputs[i], inputs[j]);
  assert.sameValue(sign, expectedSigns[checked++]); assert.sameValue(typeof sign, "number");
}
for (const start of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const source: bigint[] = inputs.slice(start).concat(inputs.slice(0, start)); const result = ordered(source);
  assert.sameValue(result, source); assert.sameValue(result.length, 16);
  for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) { assert.sameValue(result[i], expected[i]); assert.sameValue(typeof result[i], "bigint"); }
}
assert.sameValue(checked, 256);
