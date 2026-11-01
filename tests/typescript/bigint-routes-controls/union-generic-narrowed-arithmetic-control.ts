/*---
description: Control for union-generic-narrowed-arithmetic; direct local bigint and number operands preserve the same values, updates and runtime kinds.
features: [ts-bigint-route-unions, ts-bigint, ts-numbers, ts-arrays, ts-expressions, ts-typeof-operator, ts-iteration]
---*/
// Control: numeric selectors choose the same literals; each concrete local operand is used directly, with local lets only for updates.
const arithmeticBig: bigint[] = [-1n, -1n, 2n, -4n, 5n, -7n, 8n, -10n, 20n, -22n, 27670116110564327420n, -27670116110564327425n, 55340232221128654847n, 510423550381407695195061911147652317180n, -510423550381407695195061911147652317185n, 27021597764222978n];
const arithmeticNumber: number[] = [-1, -1, 2, -4, 0.5, -2.5, NaN, Infinity, -Infinity, 27021597764222976];
for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]) {
  if (at < 16) {
    const value: bigint = at === 0 ? 0n : at === 1 ? -0n : at === 2 ? 1n : at === 3 ? -1n : at === 4 ? 2n : at === 5 ? -2n : at === 6 ? 3n : at === 7 ? -3n : at === 8 ? 7n : at === 9 ? -7n : at === 10 ? 9223372036854775807n : at === 11 ? -9223372036854775808n : at === 12 ? 18446744073709551616n : at === 13 ? 170141183460469231731687303715884105727n : at === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n;
    const result: bigint = value * 3n - 1n;
    assert.sameValue(result, arithmeticBig[at]); assert.sameValue(typeof result, "bigint");
  } else {
    const value: number = at === 16 ? -0 : at === 17 ? 0 : at === 18 ? 1 : at === 19 ? -1 : at === 20 ? 0.5 : at === 21 ? -0.5 : at === 22 ? NaN : at === 23 ? Infinity : at === 24 ? -Infinity : 9007199254740992;
    const result: number = value * 3 - 1;
    assert.sameValue(result, arithmeticNumber[at - 16]); assert.sameValue(typeof result, "number");
  }
}
