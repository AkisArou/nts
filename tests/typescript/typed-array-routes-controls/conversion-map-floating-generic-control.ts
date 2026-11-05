/*---
description: "Map converts every floating element kind at its width, sign and precision boundaries. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-conversion, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-function-types, ts-arrow-functions, ts-generics, ts-generic-constraints, ts-objects]
---*/

function localClamp(value: number): number {
  if (!(value > 0)) return 0; if (value >= 255) return 255; const n = Math.floor(value);
  return value - n < 0.5 ? n : value - n > 0.5 ? n + 1 : n % 2 === 0 ? n : n + 1;
}
const localFloatRows: readonly [number, number][] = [[0, 0], [-5, -5], [300, 300], [1.5, 1.5], [2.5, 2.5], [0.5, 0.5], [254.5, 254.5], [3.5, 3.5], [-0, -0], [0.1, 0.10000000149011612], [16777217, 16777216], [1e+40, Infinity], [1e-50, 0], [-1e-50, -0], [NaN, NaN], [Infinity, Infinity], [-Infinity, -Infinity]];
function localFloat(value: number): number { for (const [input, result] of localFloatRows) if (Object.is(value, input)) return result; throw new RangeError("unlisted float"); }
function localBuild(data: number | readonly number[], convert: (value: number) => number): number[] { const result: number[] = [];
  if (typeof data === "number") for (let i = 0; i < data; i++) result[i] = 0; else for (let i = 0; i < data.length; i++) result[i] = convert(data[i]); return result; }
function localMap(data: number[], callback: (value: number, index: number) => number, convert: (value: number) => number): number[] { const result: number[] = []; for (let i = 0; i < data.length; i++) result[i] = convert(callback(data[i], i)); return result; }
function localUint8ClampedArray(data: number | readonly number[]): number[] { return localBuild(data, localClamp); }
function localMapUint8ClampedArray(data: number[], callback: (value: number, index: number) => number): number[] { return localMap(data, callback, localClamp); }
function localFloat32Array(data: number | readonly number[]): number[] { return localBuild(data, localFloat); }
function localMapFloat32Array(data: number[], callback: (value: number, index: number) => number): number[] { return localMap(data, callback, localFloat); }
function localFloat64Array(data: number | readonly number[]): number[] { return localBuild(data, value => value); }
function localMapFloat64Array(data: number[], callback: (value: number, index: number) => number): number[] { return localMap(data, callback, value => value); }
// Map converts every floating element kind at its width, sign and precision boundaries. Route: a constrained input helper at two type arguments.
// Node prints conversion-map-floating-generic:ok.
type ConversionArray = number[];
type ConvertValues = (values: readonly number[]) => ConversionArray;
const inputs: readonly number[] = [0, -5, 300, 1.5, 2.5, 0.5, 254.5, 3.5, -0, 0.1, 16777217, 1e+40, 1e-50, -1e-50, NaN, Infinity, -Infinity];
const writers: readonly ConvertValues[] = [
  values => { const data0 = localUint8ClampedArray(values.length); return localMapUint8ClampedArray(data0, (_value, index) => values[index]); },
  values => { const data1 = localFloat32Array(values.length); return localMapFloat32Array(data1, (_value, index) => values[index]); },
  values => { const data2 = localFloat64Array(values.length); return localMapFloat64Array(data2, (_value, index) => values[index]); },
];
const expected: readonly (readonly number[])[] = [
  [0, 0, 255, 2, 2, 0, 254, 4, 0, 0, 255, 255, 0, 0, 0, 255, 0],
  [0, -5, 300, 1.5, 2.5, 0.5, 254.5, 3.5, -0, 0.10000000149011612, 16777216, Infinity, 0, -0, NaN, Infinity, -Infinity],
  [0, -5, 300, 1.5, 2.5, 0.5, 254.5, 3.5, -0, 0.1, 16777217, 1e+40, 1e-50, -1e-50, NaN, Infinity, -Infinity],
];
type InputValues = { values: readonly number[] }; type LabeledInput = { values: readonly number[]; label: string };
function applyValues<T extends InputValues>(plan: T, convert: ConvertValues): ConversionArray { return convert(plan.values); }
for (let kind = 0; kind < writers.length; kind++) {
  const results = [applyValues<InputValues>({ values: inputs }, writers[kind]), applyValues<LabeledInput>({ values: inputs, label: "again" }, writers[kind])]; for (const result of results) {
  const actual: number[] = []; for (let i = 0; i < result.length; i++) actual[i] = result[i]; assert.compareArray(actual, expected[kind]); }
}
console.log("conversion-map-floating-generic:ok");
