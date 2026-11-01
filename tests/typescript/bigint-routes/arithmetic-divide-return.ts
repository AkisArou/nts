/*---
description: Declared bigint returns preserve division truncating toward zero for both operand signs.
features: [ts-bigint-route-arithmetic, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator, ts-expressions, ts-functions]
---*/
// Declared bigint returns carry the dividend and divisor into division; node truncates signed quotients toward zero.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const others: bigint[] = [3n, -3n];
function carried(value: bigint): bigint { return value; }
const expectedQuotient: bigint[] = [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, 1n, -1n, -1n, 1n, 2n, -2n, -2n, 2n, 3074457345618258602n, -3074457345618258602n, -3074457345618258602n, 3074457345618258602n, 6148914691236517205n, -6148914691236517205n, 56713727820156410577229101238628035242n, -56713727820156410577229101238628035242n, -56713727820156410577229101238628035242n, 56713727820156410577229101238628035242n, 3002399751580331n, -3002399751580331n];
let checked = 0;
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) for (const j of [0, 1]) {
  const a: bigint = inputs[i];
  const b: bigint = others[j];
  const quotient: bigint = carried(a) / carried(b);
  assert.sameValue(quotient, expectedQuotient[checked]); assert.sameValue(typeof quotient, "bigint");
  checked++;
}
assert.sameValue(checked, 32);
