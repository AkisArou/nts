/*---
description: "Map converts every integers element kind at its width, sign and precision boundaries."
features: [ts-typed-array-routes, ts-typed-array-route-conversion, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-function-types, ts-arrow-functions, ts-generics, ts-generic-constraints, ts-objects]
---*/

// Map converts every integers element kind at its width, sign and precision boundaries. Route: a constrained input helper at two type arguments.
// Node prints conversion-map-integers-generic:ok.
type ConversionArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array;
type ConvertValues = (values: readonly number[]) => ConversionArray;
const inputs: readonly number[] = [0, -0, -1, 127, 128, -128, -129, 255, 256, 32767, 32768, -32768, -32769, 65535, 65536, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 4294967301, 3.9, -3.9, -0.9, NaN, Infinity, -Infinity];
const writers: readonly ConvertValues[] = [
  values => { const data0 = new Int8Array(values.length); return data0.map((_value, index) => values[index]); },
  values => { const data1 = new Uint8Array(values.length); return data1.map((_value, index) => values[index]); },
  values => { const data2 = new Int16Array(values.length); return data2.map((_value, index) => values[index]); },
  values => { const data3 = new Uint16Array(values.length); return data3.map((_value, index) => values[index]); },
  values => { const data4 = new Int32Array(values.length); return data4.map((_value, index) => values[index]); },
  values => { const data5 = new Uint32Array(values.length); return data5.map((_value, index) => values[index]); },
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
