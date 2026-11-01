/*---
description: Control for boundary-literal-widen-crossings; local bigint constants preserve the same boundary results and exceptions.
features: [ts-bigint-route-boundaries, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator, ts-expressions]
---*/
// Control: numeric selectors choose local bigint literals; direct operations replace the tested storage or generic route.
const expectedAbove: bigint[] = [1n, 1n, 2n, 0n, 3n, -1n, 4n, -2n, 8n, -6n, 9223372036854775808n, -9223372036854775807n, 18446744073709551617n, 170141183460469231731687303715884105728n, -170141183460469231731687303715884105727n, 9007199254740994n];
const expectedBelow: bigint[] = [-1n, -1n, 0n, -2n, 1n, -3n, 2n, -4n, 6n, -8n, 9223372036854775806n, -9223372036854775809n, 18446744073709551615n, 170141183460469231731687303715884105726n, -170141183460469231731687303715884105729n, 9007199254740992n];
const expectedNegated: bigint[] = [0n, 0n, -1n, 1n, -2n, 2n, -3n, 3n, -7n, 7n, -9223372036854775807n, 9223372036854775808n, -18446744073709551616n, -170141183460469231731687303715884105727n, 170141183460469231731687303715884105728n, -9007199254740993n];
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const value: bigint = i === 0 ? 0n : i === 1 ? -0n : i === 2 ? 1n : i === 3 ? -1n : i === 4 ? 2n : i === 5 ? -2n : i === 6 ? 3n : i === 7 ? -3n : i === 8 ? 7n : i === 9 ? -7n : i === 10 ? 9223372036854775807n : i === 11 ? -9223372036854775808n : i === 12 ? 18446744073709551616n : i === 13 ? 170141183460469231731687303715884105727n : i === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n;
  const above: bigint = value + 1n, below: bigint = value - 1n, negated: bigint = -value;
  assert.sameValue(above, expectedAbove[i]); assert.sameValue(typeof above, "bigint");
  assert.sameValue(below, expectedBelow[i]); assert.sameValue(typeof below, "bigint");
  assert.sameValue(negated, expectedNegated[i]); assert.sameValue(typeof negated, "bigint");
}
