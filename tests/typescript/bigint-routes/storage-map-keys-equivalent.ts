/*---
description: Equal bigint Map keys computed by different operations replace one entry at every signed range edge.
features: [ts-bigint-route-storage, ts-bigint, ts-arrays, ts-typeof-operator, ts-map-set]
---*/
// Route: Map<bigint, bigint> keys are reconstructed by xor and division; node finds one value key, including at 128 bits.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const changed: bigint[] = [-1n, -1n, -2n, 0n, -3n, 1n, -4n, 2n, -8n, 6n, -9223372036854775808n, 9223372036854775807n, -18446744073709551617n, -170141183460469231731687303715884105728n, 170141183460469231731687303715884105727n, -9007199254740994n];
for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const value: bigint = inputs[at];
  const equivalent: bigint = (value ^ 85n) ^ 85n, query: bigint = (value / 2n) * 2n + value % 2n;
  const table = new Map<bigint, bigint>(); table.set(value, value); table.set(equivalent, ~value);
  const read = table.get(query); if (read === undefined) throw new Error("missing equivalent key");
  const size: number = table.size, found: boolean = table.has(equivalent), missed: boolean = table.has(value ^ 1n);
  assert.sameValue(equivalent, expected[at]); assert.sameValue(typeof equivalent, "bigint");
  assert.sameValue(query, expected[at]); assert.sameValue(typeof query, "bigint");
  assert.sameValue(read, changed[at]); assert.sameValue(typeof read, "bigint");
  assert.sameValue(size, 1); assert.sameValue(typeof size, "number");
  assert.sameValue(found, true); assert.sameValue(typeof found, "boolean");
  assert.sameValue(missed, false); assert.sameValue(typeof missed, "boolean");
}
