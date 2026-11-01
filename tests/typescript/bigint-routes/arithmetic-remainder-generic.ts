/*---
description: A bigint-constrained generic return preserves the dividend sign in every remainder.
features: [ts-bigint-route-arithmetic, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator, ts-expressions, ts-functions, ts-generics, ts-generic-constraints]
---*/
// Generic bigint returns carry signed edge operands to %; node gives the remainder the dividend sign.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const others: bigint[] = [3n, -3n];
function carried<T extends bigint>(value: T): T { return value; }
const expectedRemainder: bigint[] = [0n, 0n, 0n, 0n, 1n, 1n, -1n, -1n, 2n, 2n, -2n, -2n, 0n, 0n, 0n, 0n, 1n, 1n, -1n, -1n, 1n, 1n, -2n, -2n, 1n, 1n, 1n, 1n, -2n, -2n, 0n, 0n];
let checked = 0;
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) for (const j of [0, 1]) {
  const a: bigint = inputs[i];
  const b: bigint = others[j];
  const remainder: bigint = carried(a) % carried(b);
  assert.sameValue(remainder, expectedRemainder[checked]); assert.sameValue(typeof remainder, "bigint");
  checked++;
}
assert.sameValue(checked, 32);
