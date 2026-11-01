/*---
description: Postfix and prefix increment of a number-or-bigint field preserve each returned value, final state and runtime kind.
features: [ts-bigint-route-unions, ts-bigint, ts-numbers, ts-arrays, ts-expressions, ts-typeof-operator, ts-iteration, ts-unions, ts-objects]
---*/
// Route: a number | bigint field receives postfix then prefix increment; node returns the old value then the updated value and keeps each write visible.
const holder: { value: number | bigint } = { value: 0n };
const inputs: (number | bigint)[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n, -0, 0, 1, -1, 0.5, -0.5, NaN, Infinity, -Infinity, 9007199254740992];
const inputBig: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const inputNumber: number[] = [-0, 0, 1, -1, 0.5, -0.5, NaN, Infinity, -Infinity, 9007199254740992];
const incrementOneBig: bigint[] = [1n, 1n, 2n, 0n, 3n, -1n, 4n, -2n, 8n, -6n, 9223372036854775808n, -9223372036854775807n, 18446744073709551617n, 170141183460469231731687303715884105728n, -170141183460469231731687303715884105727n, 9007199254740994n];
const incrementOneNumber: number[] = [1, 1, 2, 0, 1.5, 0.5, NaN, Infinity, -Infinity, 9007199254740992];
const incrementTwoBig: bigint[] = [2n, 2n, 3n, 1n, 4n, 0n, 5n, -1n, 9n, -5n, 9223372036854775809n, -9223372036854775806n, 18446744073709551618n, 170141183460469231731687303715884105729n, -170141183460469231731687303715884105726n, 9007199254740995n];
const incrementTwoNumber: number[] = [2, 2, 3, 1, 2.5, 1.5, NaN, Infinity, -Infinity, 9007199254740992];
for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]) {
  holder.value = inputs[at];
  const previous = holder.value++, afterPostfix = holder.value, prefix = ++holder.value;
  assert.sameValue(previous, at < 16 ? inputBig[at] : inputNumber[at - 16]); assert.sameValue(typeof previous, at < 16 ? "bigint" : "number");
  assert.sameValue(afterPostfix, at < 16 ? incrementOneBig[at] : incrementOneNumber[at - 16]); assert.sameValue(typeof afterPostfix, at < 16 ? "bigint" : "number");
  assert.sameValue(prefix, at < 16 ? incrementTwoBig[at] : incrementTwoNumber[at - 16]); assert.sameValue(typeof prefix, at < 16 ? "bigint" : "number");
  assert.sameValue(holder.value, at < 16 ? incrementTwoBig[at] : incrementTwoNumber[at - 16]); assert.sameValue(typeof holder.value, at < 16 ? "bigint" : "number");
}
