/*---
description: A closure with a bigint return reads a later edge-value write and complement without narrowing or retaining a stale copy.
features: [ts-bigint-route-storage, ts-bigint, ts-arrays, ts-typeof-operator, ts-closures, ts-function-types, ts-arrow-functions]
---*/
// Route: a () => bigint closure captures a bigint binding before two writes; node reads 1, the edge value and its complement.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const changed: bigint[] = [-1n, -1n, -2n, 0n, -3n, 1n, -4n, 2n, -8n, 6n, -9223372036854775808n, 9223372036854775807n, -18446744073709551617n, -170141183460469231731687303715884105728n, 170141183460469231731687303715884105727n, -9007199254740994n];
for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const value: bigint = inputs[at];
  let captured: bigint = 1n; const read: () => bigint = () => captured;
  const before: bigint = read(); captured = value; const first: bigint = read();
  captured = ~value; const second: bigint = read();
  assert.sameValue(before, 1n); assert.sameValue(typeof before, "bigint");
  assert.sameValue(first, expected[at]); assert.sameValue(typeof first, "bigint");
  assert.sameValue(second, changed[at]); assert.sameValue(typeof second, "bigint");
}
