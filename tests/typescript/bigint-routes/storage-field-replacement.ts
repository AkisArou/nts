/*---
description: A declared bigint field preserves exact values and later complement writes across the signed 64-bit and 128-bit edges.
features: [ts-bigint-route-storage, ts-bigint, ts-arrays, ts-typeof-operator, ts-interfaces, ts-objects]
---*/
// Route: a bigint field receives each edge value and then its complement; node preserves both snapshots and the final field.
interface StoredBigint { value: bigint; }
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const changed: bigint[] = [-1n, -1n, -2n, 0n, -3n, 1n, -4n, 2n, -8n, 6n, -9223372036854775808n, 9223372036854775807n, -18446744073709551617n, -170141183460469231731687303715884105728n, 170141183460469231731687303715884105727n, -9007199254740994n];
for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const value: bigint = inputs[at];
  const holder: StoredBigint = { value: 1n }; holder.value = value;
  const first: bigint = holder.value; holder.value = ~value;
  const second: bigint = holder.value; const retained: bigint = first;
  assert.sameValue(first, expected[at]); assert.sameValue(typeof first, "bigint");
  assert.sameValue(second, changed[at]); assert.sameValue(typeof second, "bigint");
  assert.sameValue(retained, expected[at]); assert.sameValue(typeof retained, "bigint");
}
