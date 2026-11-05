/*---
description: "Constructing single-precision elements from doubles rounds each value while preserving a separate source. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-class, ts-class-fields, ts-static, ts-tuples, ts-destructuring]
---*/

const localFloatRows: readonly [number, number][] = [[0.1, 0.10000000149011612], [16777217, 16777216], [-0, -0], [Infinity, Infinity], [1.5, 1.5], [1e40, Infinity], [-1e-50, -0], [0, 0]];
function localFloat(value: number): number { for (const [input, output] of localFloatRows) if (Object.is(value, input)) return output; throw new RangeError("unlisted float"); }
function localFloat64Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = values[i]; return result; }
function localFloat32Array(values: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < values.length; i++) result[i] = localFloat(values[i]); return result; }
function localBuffer<T>(values: T[]): T[] { return values; }
// Constructing single-precision elements from doubles rounds each value while preserving a separate source. Route: a replaced static double-array field.
// Node prints construction-input-double-to-single-static:ok.
type InputSamples = number[]; type OutputSamples = number[];
class InputStore { static data: InputSamples = localFloat64Array([]); }
const rows: readonly [readonly number[], readonly number[]][] = [
  [[0.1, 16777217, -0, Infinity], [0.10000000149011612, 16777216, -0, Infinity]],
  [[1.5, 1e40, -1e-50, 0], [1.5, Infinity, -0, 0]]
];
for (const [values, expected] of rows) {
  InputStore.data = localFloat64Array(values); const result: OutputSamples = localFloat32Array(InputStore.data), actual: number[] = [];
  for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected); assert.sameValue(localBuffer(result) === localBuffer(InputStore.data), false);
  InputStore.data[0] = 9; result[1] = 2;
  assert.sameValue(result[0], expected[0]); assert.sameValue(InputStore.data[1], values[1]);
}
console.log("construction-input-double-to-single-static:ok");
