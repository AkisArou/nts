/*---
description: "Of converts every floating element kind at its width, sign and precision boundaries."
features: [ts-typed-array-routes, ts-typed-array-route-conversion, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-function-types, ts-arrow-functions]
---*/

// Of converts every floating element kind at its width, sign and precision boundaries. Route: readonly typed conversion callbacks.
// Node prints conversion-of-floating-tuple:ok.
type ConversionArray = Uint8ClampedArray | Float32Array | Float64Array;
type ConvertValues = (values: readonly number[]) => ConversionArray;
const inputs: readonly number[] = [0, -5, 300, 1.5, 2.5, 0.5, 254.5, 3.5, -0, 0.1, 16777217, 1e+40, 1e-50, -1e-50, NaN, Infinity, -Infinity];
const writers: readonly ConvertValues[] = [
  values => Uint8ClampedArray.of(...values),
  values => Float32Array.of(...values),
  values => Float64Array.of(...values),
];
const expected: readonly (readonly number[])[] = [
  [0, 0, 255, 2, 2, 0, 254, 4, 0, 0, 255, 255, 0, 0, 0, 255, 0],
  [0, -5, 300, 1.5, 2.5, 0.5, 254.5, 3.5, -0, 0.10000000149011612, 16777216, Infinity, 0, -0, NaN, Infinity, -Infinity],
  [0, -5, 300, 1.5, 2.5, 0.5, 254.5, 3.5, -0, 0.1, 16777217, 1e+40, 1e-50, -1e-50, NaN, Infinity, -Infinity],
];
for (let kind = 0; kind < writers.length; kind++) {
  const result = writers[kind](inputs);
  const actual: number[] = []; for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected[kind]);
}
console.log("conversion-of-floating-tuple:ok");
