/*---
description: "Constructing signed 64-bit elements from unsigned elements preserves top bits and makes a copy."
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-bigint, ts-closures, ts-arrow-functions, ts-tuples, ts-destructuring]
---*/

// Constructing signed 64-bit elements from unsigned elements preserves top bits and makes a copy. Route: a closure over a replaced unsigned bigint source.
// Node prints construction-input-biguint-to-bigint-closure:ok.
type InputSamples = BigUint64Array; type OutputSamples = BigInt64Array;
let current: InputSamples = new BigUint64Array([]);
const copy = (): OutputSamples => new BigInt64Array(current);
const rows: readonly [readonly bigint[], readonly bigint[]][] = [
  [[9223372036854775808n, 18446744073709551615n, 9007199254740993n], [-9223372036854775808n, -1n, 9007199254740993n]],
  [[9223372036854775813n, 0n, 9223372036854775807n], [-9223372036854775803n, 0n, 9223372036854775807n]]
];
for (const [values, expected] of rows) {
  current = new BigUint64Array(values); const result = copy(), actual: bigint[] = [];
  for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected); assert.sameValue(result.buffer === current.buffer, false);
  current[0] = 1n; result[1] = 3n;
  assert.sameValue(result[0], expected[0]); assert.sameValue(current[1], values[1]);
}
console.log("construction-input-biguint-to-bigint-closure:ok");
