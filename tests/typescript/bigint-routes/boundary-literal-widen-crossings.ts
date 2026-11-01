/*---
description: Widened bigint literal returns preserve arithmetic crossing signed 64-bit and 128-bit boundaries.
features: [ts-bigint-route-boundaries, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator, ts-literal-types, ts-unions, ts-functions, ts-expressions]
---*/
// A bigint literal union widens through a declared bigint return before +1, -1 and negation; node keeps results beyond both machine boundaries.
type BoundaryLiteral = 0n | -0n | 1n | -1n | 2n | -2n | 3n | -3n | 7n | -7n | 9223372036854775807n | -9223372036854775808n | 18446744073709551616n | 170141183460469231731687303715884105727n | -170141183460469231731687303715884105728n | 9007199254740993n;
const inputs: BoundaryLiteral[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
function widen(value: BoundaryLiteral): bigint { return value; }
const expectedAbove: bigint[] = [1n, 1n, 2n, 0n, 3n, -1n, 4n, -2n, 8n, -6n, 9223372036854775808n, -9223372036854775807n, 18446744073709551617n, 170141183460469231731687303715884105728n, -170141183460469231731687303715884105727n, 9007199254740994n];
const expectedBelow: bigint[] = [-1n, -1n, 0n, -2n, 1n, -3n, 2n, -4n, 6n, -8n, 9223372036854775806n, -9223372036854775809n, 18446744073709551615n, 170141183460469231731687303715884105726n, -170141183460469231731687303715884105729n, 9007199254740992n];
const expectedNegated: bigint[] = [0n, 0n, -1n, 1n, -2n, 2n, -3n, 3n, -7n, 7n, -9223372036854775807n, 9223372036854775808n, -18446744073709551616n, -170141183460469231731687303715884105727n, 170141183460469231731687303715884105728n, -9007199254740993n];
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const value: bigint = widen(inputs[i]);
  const above: bigint = value + 1n, below: bigint = value - 1n, negated: bigint = -value;
  assert.sameValue(above, expectedAbove[i]); assert.sameValue(typeof above, "bigint");
  assert.sameValue(below, expectedBelow[i]); assert.sameValue(typeof below, "bigint");
  assert.sameValue(negated, expectedNegated[i]); assert.sameValue(typeof negated, "bigint");
}
