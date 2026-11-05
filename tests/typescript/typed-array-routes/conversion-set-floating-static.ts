/*---
description: "Set converts every floating element kind at its width, sign and precision boundaries."
features: [ts-typed-array-routes, ts-typed-array-route-conversion, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-function-types, ts-arrow-functions, ts-class, ts-class-fields, ts-static]
---*/

// Set converts every floating element kind at its width, sign and precision boundaries. Route: a reassigned static callback field.
// Node prints conversion-set-floating-static:ok.
type ConversionArray = Uint8ClampedArray | Float32Array | Float64Array;
type ConvertValues = (values: readonly number[]) => ConversionArray;
const inputs: readonly number[] = [0, -5, 300, 1.5, 2.5, 0.5, 254.5, 3.5, -0, 0.1, 16777217, 1e+40, 1e-50, -1e-50, NaN, Infinity, -Infinity];
const writers: readonly ConvertValues[] = [
  values => { const data0 = new Uint8ClampedArray(values.length); data0.set(values); return data0; },
  values => { const data1 = new Float32Array(values.length); data1.set(values); return data1; },
  values => { const data2 = new Float64Array(values.length); data2.set(values); return data2; },
];
const expected: readonly (readonly number[])[] = [
  [0, 0, 255, 2, 2, 0, 254, 4, 0, 0, 255, 255, 0, 0, 0, 255, 0],
  [0, -5, 300, 1.5, 2.5, 0.5, 254.5, 3.5, -0, 0.10000000149011612, 16777216, Infinity, 0, -0, NaN, Infinity, -Infinity],
  [0, -5, 300, 1.5, 2.5, 0.5, 254.5, 3.5, -0, 0.1, 16777217, 1e+40, 1e-50, -1e-50, NaN, Infinity, -Infinity],
];
class ConversionDispatch { static run: ConvertValues = writers[0]; }
for (let kind = 0; kind < writers.length; kind++) {
  ConversionDispatch.run = writers[kind]; const result = ConversionDispatch.run(inputs);
  const actual: number[] = []; for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected[kind]);
}
console.log("conversion-set-floating-static:ok");
