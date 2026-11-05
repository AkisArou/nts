/*---
description: "Map converts every integers element kind at its width, sign and precision boundaries. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-conversion, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-function-types, ts-arrow-functions, ts-generics, ts-generic-constraints, ts-objects]
---*/

function localInteger(value: number, bits: number, signed: boolean): number { if (!Number.isFinite(value)) return 0; const modulus = 2 ** bits;
  const n = (Math.trunc(value) % modulus + modulus) % modulus; return signed && n >= modulus / 2 ? n - modulus : n; }
function localBuild(data: number | readonly number[], convert: (value: number) => number): number[] { const result: number[] = [];
  if (typeof data === "number") for (let i = 0; i < data; i++) result[i] = 0; else for (let i = 0; i < data.length; i++) result[i] = convert(data[i]); return result; }
function localMap(data: number[], callback: (value: number, index: number) => number, convert: (value: number) => number): number[] { const result: number[] = []; for (let i = 0; i < data.length; i++) result[i] = convert(callback(data[i], i)); return result; }
function localInt8Array(data: number | readonly number[]): number[] { return localBuild(data, value => localInteger(value, 8, true)); }
function localMapInt8Array(data: number[], callback: (value: number, index: number) => number): number[] { return localMap(data, callback, value => localInteger(value, 8, true)); }
function localUint8Array(data: number | readonly number[]): number[] { return localBuild(data, value => localInteger(value, 8, false)); }
function localMapUint8Array(data: number[], callback: (value: number, index: number) => number): number[] { return localMap(data, callback, value => localInteger(value, 8, false)); }
function localInt16Array(data: number | readonly number[]): number[] { return localBuild(data, value => localInteger(value, 16, true)); }
function localMapInt16Array(data: number[], callback: (value: number, index: number) => number): number[] { return localMap(data, callback, value => localInteger(value, 16, true)); }
function localUint16Array(data: number | readonly number[]): number[] { return localBuild(data, value => localInteger(value, 16, false)); }
function localMapUint16Array(data: number[], callback: (value: number, index: number) => number): number[] { return localMap(data, callback, value => localInteger(value, 16, false)); }
function localInt32Array(data: number | readonly number[]): number[] { return localBuild(data, value => localInteger(value, 32, true)); }
function localMapInt32Array(data: number[], callback: (value: number, index: number) => number): number[] { return localMap(data, callback, value => localInteger(value, 32, true)); }
function localUint32Array(data: number | readonly number[]): number[] { return localBuild(data, value => localInteger(value, 32, false)); }
function localMapUint32Array(data: number[], callback: (value: number, index: number) => number): number[] { return localMap(data, callback, value => localInteger(value, 32, false)); }
// Map converts every integers element kind at its width, sign and precision boundaries. Route: a constrained input helper at two type arguments.
// Node prints conversion-map-integers-generic:ok.
type ConversionArray = number[];
type ConvertValues = (values: readonly number[]) => ConversionArray;
const inputs: readonly number[] = [0, -0, -1, 127, 128, -128, -129, 255, 256, 32767, 32768, -32768, -32769, 65535, 65536, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 4294967301, 3.9, -3.9, -0.9, NaN, Infinity, -Infinity];
const writers: readonly ConvertValues[] = [
  values => { const data0 = localInt8Array(values.length); return localMapInt8Array(data0, (_value, index) => values[index]); },
  values => { const data1 = localUint8Array(values.length); return localMapUint8Array(data1, (_value, index) => values[index]); },
  values => { const data2 = localInt16Array(values.length); return localMapInt16Array(data2, (_value, index) => values[index]); },
  values => { const data3 = localUint16Array(values.length); return localMapUint16Array(data3, (_value, index) => values[index]); },
  values => { const data4 = localInt32Array(values.length); return localMapInt32Array(data4, (_value, index) => values[index]); },
  values => { const data5 = localUint32Array(values.length); return localMapUint32Array(data5, (_value, index) => values[index]); },
];
const expected: readonly (readonly number[])[] = [
  [0, 0, -1, 127, -128, -128, 127, -1, 0, -1, 0, 0, -1, -1, 0, -1, 0, 0, -1, -1, 0, 5, 3, -3, 0, 0, 0, 0],
  [0, 0, 255, 127, 128, 128, 127, 255, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0, 255, 255, 0, 5, 3, 253, 0, 0, 0, 0],
  [0, 0, -1, 127, 128, -128, -129, 255, 256, 32767, -32768, -32768, 32767, -1, 0, -1, 0, 0, -1, -1, 0, 5, 3, -3, 0, 0, 0, 0],
  [0, 0, 65535, 127, 128, 65408, 65407, 255, 256, 32767, 32768, 32768, 32767, 65535, 0, 65535, 0, 0, 65535, 65535, 0, 5, 3, 65533, 0, 0, 0, 0],
  [0, 0, -1, 127, 128, -128, -129, 255, 256, 32767, 32768, -32768, -32769, 65535, 65536, 2147483647, -2147483648, -2147483648, 2147483647, -1, 0, 5, 3, -3, 0, 0, 0, 0],
  [0, 0, 4294967295, 127, 128, 4294967168, 4294967167, 255, 256, 32767, 32768, 4294934528, 4294934527, 65535, 65536, 2147483647, 2147483648, 2147483648, 2147483647, 4294967295, 0, 5, 3, 4294967293, 0, 0, 0, 0],
];
type InputValues = { values: readonly number[] }; type LabeledInput = { values: readonly number[]; label: string };
function applyValues<T extends InputValues>(plan: T, convert: ConvertValues): ConversionArray { return convert(plan.values); }
for (let kind = 0; kind < writers.length; kind++) {
  const results = [applyValues<InputValues>({ values: inputs }, writers[kind]), applyValues<LabeledInput>({ values: inputs, label: "again" }, writers[kind])]; for (const result of results) {
  const actual: number[] = []; for (let i = 0; i < result.length; i++) actual[i] = result[i]; assert.compareArray(actual, expected[kind]); }
}
console.log("conversion-map-integers-generic:ok");
