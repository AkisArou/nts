/*---
description: Control for storage-map-boxed-keys; local literal bigint constants preserve the same values and observations.
features: [ts-bigint-route-storage, ts-bigint, ts-arrays, ts-typeof-operator]
---*/
// Control: numeric selectors choose local bigint literals; direct operations replace storage and capture.
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const numberValues: bigint[] = [2n, 2n, 3n, -3n, 0n, -4n, 1n, -1n, 5n, -5n, 9223372036854775805n, -9223372036854775806n, 18446744073709551618n, 170141183460469231731687303715884105725n, -170141183460469231731687303715884105726n, 9007199254740995n];
for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const value: bigint = at === 0 ? 0n : at === 1 ? -0n : at === 2 ? 1n : at === 3 ? -1n : at === 4 ? 2n : at === 5 ? -2n : at === 6 ? 3n : at === 7 ? -3n : at === 8 ? 7n : at === 9 ? -7n : at === 10 ? 9223372036854775807n : at === 11 ? -9223372036854775808n : at === 12 ? 18446744073709551616n : at === 13 ? 170141183460469231731687303715884105727n : at === 14 ? -170141183460469231731687303715884105728n : 9007199254740993n;
  const equivalent: bigint = (value ^ 85n) ^ 85n; const numeric: number = at % 2;
  let bigPresent: boolean = true; const numberPresent: boolean = true;
  const read: bigint = value, numberRead: bigint = value ^ 2n; const size: number = (bigPresent ? 1 : 0) + (numberPresent ? 1 : 0);
  const deleted: boolean = bigPresent && value === equivalent; if (deleted) bigPresent = false;
  const remains: boolean = bigPresent, numberRemains: boolean = numberPresent && numeric === at % 2;
  const finalSize: number = (bigPresent ? 1 : 0) + (numberPresent ? 1 : 0);
  assert.sameValue(equivalent, expected[at]); assert.sameValue(typeof equivalent, "bigint");
  assert.sameValue(read, expected[at]); assert.sameValue(typeof read, "bigint");
  assert.sameValue(numberRead, numberValues[at]); assert.sameValue(typeof numberRead, "bigint");
  assert.sameValue(size, 2); assert.sameValue(typeof size, "number");
  assert.sameValue(deleted, true); assert.sameValue(typeof deleted, "boolean");
  assert.sameValue(remains, false); assert.sameValue(typeof remains, "boolean");
  assert.sameValue(numberRemains, true); assert.sameValue(typeof numberRemains, "boolean");
  assert.sameValue(finalSize, 1); assert.sameValue(typeof finalSize, "number");
}
