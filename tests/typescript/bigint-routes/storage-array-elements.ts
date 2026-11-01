/*---
description: Bigint array elements preserve wide payloads through replacement without changing a separately read value.
features: [ts-bigint-route-storage, ts-bigint, ts-arrays, ts-typeof-operator]
---*/
// Route: bigint array slots receive an edge value and its complement, then one slot replaces another; node retains exact copies.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const changed: bigint[] = [-1n, -1n, -2n, 0n, -3n, 1n, -4n, 2n, -8n, 6n, -9223372036854775808n, 9223372036854775807n, -18446744073709551617n, -170141183460469231731687303715884105728n, 170141183460469231731687303715884105727n, -9007199254740994n];
for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const value: bigint = inputs[at];
  const slots: bigint[] = [1n, 2n]; slots[0] = value; slots[1] = ~value;
  const first: bigint = slots[0], second: bigint = slots[1]; slots[0] = slots[1];
  const after: bigint = slots[0];
  assert.sameValue(first, expected[at]); assert.sameValue(typeof first, "bigint");
  assert.sameValue(second, changed[at]); assert.sameValue(typeof second, "bigint");
  assert.sameValue(after, changed[at]); assert.sameValue(typeof after, "bigint");
}
