/*---
description: Control for union-field-increment; direct local bigint and number operands preserve the same values, updates and runtime kinds.
features: [ts-bigint-route-unions, ts-bigint, ts-numbers, ts-arrays, ts-expressions, ts-typeof-operator, ts-iteration]
---*/
// Control: numeric selectors choose the same literals; each concrete local operand is used directly, with local lets only for updates.
const inputBig: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const inputNumber: number[] = [-0, 0, 1, -1, 0.5, -0.5, NaN, Infinity, -Infinity, 9007199254740992];
const incrementOneBig: bigint[] = [1n, 1n, 2n, 0n, 3n, -1n, 4n, -2n, 8n, -6n, 9223372036854775808n, -9223372036854775807n, 18446744073709551617n, 170141183460469231731687303715884105728n, -170141183460469231731687303715884105727n, 9007199254740994n];
const incrementOneNumber: number[] = [1, 1, 2, 0, 1.5, 0.5, NaN, Infinity, -Infinity, 9007199254740992];
const incrementTwoBig: bigint[] = [2n, 2n, 3n, 1n, 4n, 0n, 5n, -1n, 9n, -5n, 9223372036854775809n, -9223372036854775806n, 18446744073709551618n, 170141183460469231731687303715884105729n, -170141183460469231731687303715884105726n, 9007199254740995n];
const incrementTwoNumber: number[] = [2, 2, 3, 1, 2.5, 1.5, NaN, Infinity, -Infinity, 9007199254740992];
for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]) {
  if (at < 16) {
    let value: bigint = at === 0 ? 0n : at === 1 ? -0n : at === 2 ? 1n : at === 3 ? -1n : at === 4 ? 2n : at === 5 ? -2n : at === 6 ? 3n : at === 7 ? -3n : at === 8 ? 7n : at === 9 ? -7n : at === 10 ? 9223372036854775807n : at === 11 ? -9223372036854775808n : at === 12 ? 18446744073709551616n : at === 13 ? 170141183460469231731687303715884105727n : at === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n;
    const previous: bigint = value++, afterPostfix: bigint = value, prefix: bigint = ++value;
    assert.sameValue(previous, inputBig[at]); assert.sameValue(typeof previous, "bigint");
    assert.sameValue(afterPostfix, incrementOneBig[at]); assert.sameValue(typeof afterPostfix, "bigint");
    assert.sameValue(prefix, incrementTwoBig[at]); assert.sameValue(typeof prefix, "bigint");
    assert.sameValue(value, incrementTwoBig[at]); assert.sameValue(typeof value, "bigint");
  } else {
    let value: number = at === 16 ? -0 : at === 17 ? 0 : at === 18 ? 1 : at === 19 ? -1 : at === 20 ? 0.5 : at === 21 ? -0.5 : at === 22 ? NaN : at === 23 ? Infinity : at === 24 ? -Infinity : 9007199254740992;
    const previous: number = value++, afterPostfix: number = value, prefix: number = ++value;
    assert.sameValue(previous, inputNumber[at - 16]); assert.sameValue(typeof previous, "number");
    assert.sameValue(afterPostfix, incrementOneNumber[at - 16]); assert.sameValue(typeof afterPostfix, "number");
    assert.sameValue(prefix, incrementTwoNumber[at - 16]); assert.sameValue(typeof prefix, "number");
    assert.sameValue(value, incrementTwoNumber[at - 16]); assert.sameValue(typeof value, "number");
  }
}
