/*---
description: Equal bigint Set members reconstructed by different operations occupy one entry and delete by value.
features: [ts-bigint-route-storage, ts-bigint, ts-arrays, ts-typeof-operator, ts-map-set]
---*/
// Route: Set<bigint> receives an edge value twice through different computations; node retains one member and deletes it by value.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const value: bigint = inputs[at];
  const equivalent: bigint = (value ^ 85n) ^ 85n, query: bigint = (value / 2n) * 2n + value % 2n;
  const members = new Set<bigint>(); members.add(value); members.add(equivalent);
  const size: number = members.size, found: boolean = members.has(query), missed: boolean = members.has(value ^ 1n);
  const deleted: boolean = members.delete(query), remains: boolean = members.has(value); const finalSize: number = members.size;
  assert.sameValue(equivalent, expected[at]); assert.sameValue(typeof equivalent, "bigint");
  assert.sameValue(query, expected[at]); assert.sameValue(typeof query, "bigint");
  assert.sameValue(size, 1); assert.sameValue(typeof size, "number");
  assert.sameValue(found, true); assert.sameValue(typeof found, "boolean");
  assert.sameValue(missed, false); assert.sameValue(typeof missed, "boolean");
  assert.sameValue(deleted, true); assert.sameValue(typeof deleted, "boolean");
  assert.sameValue(remains, false); assert.sameValue(typeof remains, "boolean");
  assert.sameValue(finalSize, 0); assert.sameValue(typeof finalSize, "number");
}
