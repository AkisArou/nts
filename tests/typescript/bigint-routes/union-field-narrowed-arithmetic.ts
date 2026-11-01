/*---
description: A reassigned number-or-bigint field narrowed by typeof retains exact arithmetic values and their runtime kinds.
features: [ts-bigint-route-unions, ts-bigint, ts-numbers, ts-arrays, ts-expressions, ts-typeof-operator, ts-iteration, ts-unions, ts-objects]
---*/
// Route: one number | bigint field is repeatedly reassigned and narrowed; node observes the current payload kind and exact multiply/subtract result.
const holder: { value: number | bigint } = { value: 0n };
const inputs: (number | bigint)[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n, -0, 0, 1, -1, 0.5, -0.5, NaN, Infinity, -Infinity, 9007199254740992];
const arithmeticBig: bigint[] = [-1n, -1n, 2n, -4n, 5n, -7n, 8n, -10n, 20n, -22n, 27670116110564327420n, -27670116110564327425n, 55340232221128654847n, 510423550381407695195061911147652317180n, -510423550381407695195061911147652317185n, 27021597764222978n];
const arithmeticNumber: number[] = [-1, -1, 2, -4, 0.5, -2.5, NaN, Infinity, -Infinity, 27021597764222976];
for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]) {
  holder.value = inputs[at];
  const result = typeof holder.value === "bigint" ? holder.value * 3n - 1n : holder.value * 3 - 1;
  assert.sameValue(result, at < 16 ? arithmeticBig[at] : arithmeticNumber[at - 16]); assert.sameValue(typeof result, at < 16 ? "bigint" : "number");
}
