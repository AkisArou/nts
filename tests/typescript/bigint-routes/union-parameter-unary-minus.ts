/*---
description: Unary minus on a number-or-bigint parameter preserves bigint precision, number signed zero and the returned runtime kind.
features: [ts-bigint-route-unions, ts-bigint, ts-numbers, ts-arrays, ts-expressions, ts-typeof-operator, ts-iteration, ts-unions, ts-functions]
---*/
// Route: a number | bigint parameter reaches unary minus without a conversion; node negates each kind and preserves number zero signs.
function negate(value: number | bigint): number | bigint { return -value; }
const inputs: (number | bigint)[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n, -0, 0, 1, -1, 0.5, -0.5, NaN, Infinity, -Infinity, 9007199254740992];
const negateBig: bigint[] = [0n, 0n, -1n, 1n, -2n, 2n, -3n, 3n, -7n, 7n, -9223372036854775807n, 9223372036854775808n, -18446744073709551616n, -170141183460469231731687303715884105727n, 170141183460469231731687303715884105728n, -9007199254740993n];
const negateNumber: number[] = [0, -0, -1, 1, -0.5, 0.5, NaN, -Infinity, Infinity, -9007199254740992];
for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]) {
  const result = negate(inputs[at]);
  assert.sameValue(result, at < 16 ? negateBig[at] : negateNumber[at - 16]); assert.sameValue(typeof result, at < 16 ? "bigint" : "number");
}
