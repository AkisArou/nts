/*---
description: Bigint array and query parameters preserve all membership answers across equal values and adjacent range edges.
features: [ts-bigint-route-boundaries, ts-bigint, ts-arrays, ts-iteration, ts-typeof-operator, ts-functions]
---*/
// Bigint array/query parameters reach includes for every pair; node matches primitive values after an adjacent value crosses a range edge.
const inputs: bigint[] = [0n, -0n, 1n, -1n, 2n, -2n, 3n, -3n, 7n, -7n, 9223372036854775807n, -9223372036854775808n, 18446744073709551616n, 170141183460469231731687303715884105727n, -170141183460469231731687303715884105728n, 9007199254740993n];
function contains(values: bigint[], query: bigint): boolean { return values.includes(query); }
const expected = "TTTFFFFFFFFFFFFFTTTFFFFFFFFFFFFFFFTFTFFFFFFFFFFFTTFTFFFFFFFFFFFFFFFFTFTFFFFFFFFFFFFTFTFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFTFTFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFTFFFFFFFFFFFFFFFFT";
let checked = 0;
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) for (const j of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
  const a: bigint = inputs[i], query: bigint = inputs[j];
  const result: boolean = contains([a, a + 1n, a], query);
  assert.sameValue(result, expected[checked++] === "T"); assert.sameValue(typeof result, "boolean");
}
assert.sameValue(checked, 256);
