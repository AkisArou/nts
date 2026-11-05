/*---
description: "With converts every floating element kind at its width, sign and precision boundaries. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-conversion, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-function-types, ts-arrow-functions, ts-map-set]
---*/

function localClamp(value: number): number {
  if (!(value > 0)) return 0; if (value >= 255) return 255; const n = Math.floor(value);
  return value - n < 0.5 ? n : value - n > 0.5 ? n + 1 : n % 2 === 0 ? n : n + 1;
}
const localFloatRows: readonly [number, number][] = [[0, 0], [-5, -5], [300, 300], [1.5, 1.5], [2.5, 2.5], [0.5, 0.5], [254.5, 254.5], [3.5, 3.5], [-0, -0], [0.1, 0.10000000149011612], [16777217, 16777216], [1e+40, Infinity], [1e-50, 0], [-1e-50, -0], [NaN, NaN], [Infinity, Infinity], [-Infinity, -Infinity]];
function localFloat(value: number): number { for (const [input, result] of localFloatRows) if (Object.is(value, input)) return result; throw new RangeError("unlisted float"); }
function localBuild(data: number | readonly number[], convert: (value: number) => number): number[] { const result: number[] = [];
  if (typeof data === "number") for (let i = 0; i < data; i++) result[i] = 0; else for (let i = 0; i < data.length; i++) result[i] = convert(data[i]); return result; }
function localWith(data: number[], index: number, value: number, convert: (value: number) => number): number[] { const result: number[] = []; for (let i = 0; i < data.length; i++) result[i] = i === index ? convert(value) : data[i]; return result; }
function localUint8ClampedArray(data: number | readonly number[]): number[] { return localBuild(data, localClamp); }
function localWithUint8ClampedArray(data: number[], index: number, value: number): number[] { return localWith(data, index, value, localClamp); }
function localFloat32Array(data: number | readonly number[]): number[] { return localBuild(data, localFloat); }
function localWithFloat32Array(data: number[], index: number, value: number): number[] { return localWith(data, index, value, localFloat); }
function localFloat64Array(data: number | readonly number[]): number[] { return localBuild(data, value => value); }
function localWithFloat64Array(data: number[], index: number, value: number): number[] { return localWith(data, index, value, value => value); }
// With converts every floating element kind at its width, sign and precision boundaries. Route: a callback read through guarded Map.get.
// Node prints conversion-with-floating-map:ok.
type ConversionArray = number[];
type ConvertValues = (values: readonly number[]) => ConversionArray;
const inputs: readonly number[] = [0, -5, 300, 1.5, 2.5, 0.5, 254.5, 3.5, -0, 0.1, 16777217, 1e+40, 1e-50, -1e-50, NaN, Infinity, -Infinity];
const writers: readonly ConvertValues[] = [
  values => { let data0 = localUint8ClampedArray(values.length); for (let i = 0; i < values.length; i++) data0 = localWithUint8ClampedArray(data0, i, values[i]); return data0; },
  values => { let data1 = localFloat32Array(values.length); for (let i = 0; i < values.length; i++) data1 = localWithFloat32Array(data1, i, values[i]); return data1; },
  values => { let data2 = localFloat64Array(values.length); for (let i = 0; i < values.length; i++) data2 = localWithFloat64Array(data2, i, values[i]); return data2; },
];
const expected: readonly (readonly number[])[] = [
  [0, 0, 255, 2, 2, 0, 254, 4, 0, 0, 255, 255, 0, 0, 0, 255, 0],
  [0, -5, 300, 1.5, 2.5, 0.5, 254.5, 3.5, -0, 0.10000000149011612, 16777216, Infinity, 0, -0, NaN, Infinity, -Infinity],
  [0, -5, 300, 1.5, 2.5, 0.5, 254.5, 3.5, -0, 0.1, 16777217, 1e+40, 1e-50, -1e-50, NaN, Infinity, -Infinity],
];
const conversionRoutes: Map<number, ConvertValues> = new Map(); for (let i = 0; i < writers.length; i++) conversionRoutes.set(i, writers[i]);
for (let kind = 0; kind < writers.length; kind++) {
  const convert = conversionRoutes.get(kind); if (convert === undefined) throw new Error("missing route"); const result = convert(inputs);
  const actual: number[] = []; for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected[kind]);
}
console.log("conversion-with-floating-map:ok");
