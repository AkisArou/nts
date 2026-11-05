/*---
description: "Constructing single-precision elements from doubles rounds each value while preserving a separate source."
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-class, ts-class-fields, ts-static, ts-tuples, ts-destructuring]
---*/

// Constructing single-precision elements from doubles rounds each value while preserving a separate source. Route: a replaced static double-array field.
// Node prints construction-input-double-to-single-static:ok.
type InputSamples = Float64Array; type OutputSamples = Float32Array;
class InputStore { static data: InputSamples = new Float64Array([]); }
const rows: readonly [readonly number[], readonly number[]][] = [
  [[0.1, 16777217, -0, Infinity], [0.10000000149011612, 16777216, -0, Infinity]],
  [[1.5, 1e40, -1e-50, 0], [1.5, Infinity, -0, 0]]
];
for (const [values, expected] of rows) {
  InputStore.data = new Float64Array(values); const result: OutputSamples = new Float32Array(InputStore.data), actual: number[] = [];
  for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected); assert.sameValue(result.buffer === InputStore.data.buffer, false);
  InputStore.data[0] = 9; result[1] = 2;
  assert.sameValue(result[0], expected[0]); assert.sameValue(InputStore.data[1], values[1]);
}
console.log("construction-input-double-to-single-static:ok");
