/*---
description: A declared bigint return preserves complement on signed 64-bit and 128-bit edge values.
features: [ts-bigint-route-arithmetic, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator, ts-expressions, ts-functions]
---*/
// A declared bigint return reaches ~; node complements all bits and keeps the exact bigint kind.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
function carried(value: bigint): bigint { return value; }
const expectedComplement: bigint[] = [-1n, -1n, -2n, 0n, -3n, 1n, -4n, 2n, -8n, 6n, -9223372036854775808n, 9223372036854775807n, -18446744073709551617n, -170141183460469231731687303715884105728n, 170141183460469231731687303715884105727n, -9007199254740994n];
let checked = 0;
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const a: bigint = inputs[i];
  const complement: bigint = ~carried(a);
  assert.sameValue(complement, expectedComplement[checked]); assert.sameValue(typeof complement, "bigint");
  checked++;
}
assert.sameValue(checked, 16);
