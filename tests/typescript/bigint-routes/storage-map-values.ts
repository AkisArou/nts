/*---
description: A Map with bigint values preserves wide payloads before and after replacement through a string key.
features: [ts-bigint-route-storage, ts-bigint, ts-arrays, ts-typeof-operator, ts-map-set]
---*/
// Route: Map<string, bigint> holds each edge payload and a later complement; node returns exact bigint values.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const expected: bigint[] = [0n, 0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
const changed: bigint[] = [-1n, -1n, -2n, 0n, -3n, 1n, -4n, 2n, -8n, 6n, -9223372036854775808n, 9223372036854775807n, -18446744073709551617n, -170141183460469231731687303715884105728n, 170141183460469231731687303715884105727n, -9007199254740994n];
for (const at of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const value: bigint = inputs[at];
  const table = new Map<string, bigint>(); table.set("value", value);
  const first = table.get("value"); if (first === undefined) throw new Error("missing first value");
  table.set("value", ~value);
  const second = table.get("value"); if (second === undefined) throw new Error("missing second value");
  assert.sameValue(first, expected[at]); assert.sameValue(typeof first, "bigint");
  assert.sameValue(second, changed[at]); assert.sameValue(typeof second, "bigint");
}
