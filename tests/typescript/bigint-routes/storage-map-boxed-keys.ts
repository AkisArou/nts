/*---
description: Bigints used as number-or-bigint Map keys keep full-width value equality while number keys remain separate.
features: [ts-bigint-route-storage, ts-bigint, ts-arrays, ts-typeof-operator, ts-map-set, ts-unions, ts-numbers]
---*/
// Route: Map<number | bigint, bigint> stores boxed edge keys beside 0 or 1; node finds reconstructed bigint keys without merging kinds.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const numberValues: bigint[] = [2n, 2n, 3n, -3n, 0n, -4n, 1n, -1n, 5n, -5n, 9223372036854775805n, -9223372036854775806n, 18446744073709551618n, 170141183460469231731687303715884105725n, -170141183460469231731687303715884105726n, 9007199254740995n];
for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const value: bigint = inputs[at];
  const equivalent: bigint = (value ^ 85n) ^ 85n; const numeric: number = at % 2;
  const table = new Map<number | bigint, bigint>(); table.set(value, value); table.set(numeric, value ^ 2n);
  const read = table.get(equivalent), numberRead = table.get(numeric);
  if (read === undefined || numberRead === undefined) throw new Error("missing typed key");
  const size: number = table.size, deleted: boolean = table.delete(equivalent);
  const remains: boolean = table.has(value), numberRemains: boolean = table.has(numeric), finalSize: number = table.size;
  assert.sameValue(equivalent, expected[at]); assert.sameValue(typeof equivalent, "bigint");
  assert.sameValue(read, expected[at]); assert.sameValue(typeof read, "bigint");
  assert.sameValue(numberRead, numberValues[at]); assert.sameValue(typeof numberRead, "bigint");
  assert.sameValue(size, 2); assert.sameValue(typeof size, "number");
  assert.sameValue(deleted, true); assert.sameValue(typeof deleted, "boolean");
  assert.sameValue(remains, false); assert.sameValue(typeof remains, "boolean");
  assert.sameValue(numberRemains, true); assert.sameValue(typeof numberRemains, "boolean");
  assert.sameValue(finalSize, 1); assert.sameValue(typeof finalSize, "number");
}
