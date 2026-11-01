/*---
description: Control for storage-map-keys-equivalent; local literal bigint constants preserve the same values and observations.
features: [ts-bigint-route-storage, ts-bigint, ts-arrays, ts-typeof-operator]
---*/
// Control: numeric selectors choose local bigint literals; direct operations replace storage and capture.
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const changed: bigint[] = [-1n, -1n, -2n, 0n, -3n, 1n, -4n, 2n, -8n, 6n, -9223372036854775808n, 9223372036854775807n, -18446744073709551617n, -170141183460469231731687303715884105728n, 170141183460469231731687303715884105727n, -9007199254740994n];
for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const value: bigint = at === 0 ? 0n : at === 1 ? -0n : at === 2 ? 1n : at === 3 ? -1n : at === 4 ? 2n : at === 5 ? -2n : at === 6 ? 3n : at === 7 ? -3n : at === 8 ? 7n : at === 9 ? -7n : at === 10 ? 9223372036854775807n : at === 11 ? -9223372036854775808n : at === 12 ? 18446744073709551616n : at === 13 ? 170141183460469231731687303715884105727n : at === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n;
  const equivalent: bigint = (value ^ 85n) ^ 85n, query: bigint = (value / 2n) * 2n + value % 2n;
  const same: boolean = value === equivalent; let size: number = 1; if (!same) size++;
  const read: bigint = query === equivalent ? ~value : value;
  const found: boolean = value === equivalent, missed: boolean = value === (value ^ 1n);
  assert.sameValue(equivalent, expected[at]); assert.sameValue(typeof equivalent, "bigint");
  assert.sameValue(query, expected[at]); assert.sameValue(typeof query, "bigint");
  assert.sameValue(read, changed[at]); assert.sameValue(typeof read, "bigint");
  assert.sameValue(size, 1); assert.sameValue(typeof size, "number");
  assert.sameValue(found, true); assert.sameValue(typeof found, "boolean");
  assert.sameValue(missed, false); assert.sameValue(typeof missed, "boolean");
}
