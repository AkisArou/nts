/*---
description: Bigint members of a number-or-bigint Set retain full-width value equality and delete independently of number members.
features: [ts-bigint-route-storage, ts-bigint, ts-arrays, ts-typeof-operator, ts-map-set, ts-unions, ts-numbers]
---*/
// Route: Set<number | bigint> stores each edge bigint and a number; node merges only equal bigint computations and keeps the number after deletion.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const value: bigint = inputs[at];
  const equivalent: bigint = (value ^ 85n) ^ 85n; const numeric: number = at % 2;
  const members = new Set<number | bigint>(); members.add(value); members.add(equivalent); members.add(numeric);
  const size: number = members.size, found: boolean = members.has(equivalent), numberFound: boolean = members.has(numeric);
  const deleted: boolean = members.delete(equivalent), remains: boolean = members.has(value);
  const numberRemains: boolean = members.has(numeric), finalSize: number = members.size;
  assert.sameValue(equivalent, expected[at]); assert.sameValue(typeof equivalent, "bigint");
  assert.sameValue(size, 2); assert.sameValue(typeof size, "number");
  assert.sameValue(found, true); assert.sameValue(typeof found, "boolean");
  assert.sameValue(numberFound, true); assert.sameValue(typeof numberFound, "boolean");
  assert.sameValue(deleted, true); assert.sameValue(typeof deleted, "boolean");
  assert.sameValue(remains, false); assert.sameValue(typeof remains, "boolean");
  assert.sameValue(numberRemains, true); assert.sameValue(typeof numberRemains, "boolean");
  assert.sameValue(finalSize, 1); assert.sameValue(typeof finalSize, "number");
}
