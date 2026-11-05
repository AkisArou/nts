/*---
description: "With converts every integers element kind at its width, sign and precision boundaries."
features: [ts-typed-array-routes, ts-typed-array-route-conversion, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-function-types, ts-arrow-functions, ts-map-set]
---*/

// With converts every integers element kind at its width, sign and precision boundaries. Route: a callback read through guarded Map.get.
// Node prints conversion-with-integers-map:ok.
type ConversionArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array;
type ConvertValues = (values: readonly number[]) => ConversionArray;
const inputs: readonly number[] = [0, -0, -1, 127, 128, -128, -129, 255, 256, 32767, 32768, -32768, -32769, 65535, 65536, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 4294967301, 3.9, -3.9, -0.9, NaN, Infinity, -Infinity];
const writers: readonly ConvertValues[] = [
  values => { let data0 = new Int8Array(values.length); for (let i = 0; i < values.length; i++) data0 = data0.with(i, values[i]); return data0; },
  values => { let data1 = new Uint8Array(values.length); for (let i = 0; i < values.length; i++) data1 = data1.with(i, values[i]); return data1; },
  values => { let data2 = new Int16Array(values.length); for (let i = 0; i < values.length; i++) data2 = data2.with(i, values[i]); return data2; },
  values => { let data3 = new Uint16Array(values.length); for (let i = 0; i < values.length; i++) data3 = data3.with(i, values[i]); return data3; },
  values => { let data4 = new Int32Array(values.length); for (let i = 0; i < values.length; i++) data4 = data4.with(i, values[i]); return data4; },
  values => { let data5 = new Uint32Array(values.length); for (let i = 0; i < values.length; i++) data5 = data5.with(i, values[i]); return data5; },
];
const expected: readonly (readonly number[])[] = [
  [0, 0, -1, 127, -128, -128, 127, -1, 0, -1, 0, 0, -1, -1, 0, -1, 0, 0, -1, -1, 0, 5, 3, -3, 0, 0, 0, 0],
  [0, 0, 255, 127, 128, 128, 127, 255, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0, 255, 255, 0, 5, 3, 253, 0, 0, 0, 0],
  [0, 0, -1, 127, 128, -128, -129, 255, 256, 32767, -32768, -32768, 32767, -1, 0, -1, 0, 0, -1, -1, 0, 5, 3, -3, 0, 0, 0, 0],
  [0, 0, 65535, 127, 128, 65408, 65407, 255, 256, 32767, 32768, 32768, 32767, 65535, 0, 65535, 0, 0, 65535, 65535, 0, 5, 3, 65533, 0, 0, 0, 0],
  [0, 0, -1, 127, 128, -128, -129, 255, 256, 32767, 32768, -32768, -32769, 65535, 65536, 2147483647, -2147483648, -2147483648, 2147483647, -1, 0, 5, 3, -3, 0, 0, 0, 0],
  [0, 0, 4294967295, 127, 128, 4294967168, 4294967167, 255, 256, 32767, 32768, 4294934528, 4294934527, 65535, 65536, 2147483647, 2147483648, 2147483648, 2147483647, 4294967295, 0, 5, 3, 4294967293, 0, 0, 0, 0],
];
const conversionRoutes: Map<number, ConvertValues> = new Map(); for (let i = 0; i < writers.length; i++) conversionRoutes.set(i, writers[i]);
for (let kind = 0; kind < writers.length; kind++) {
  const convert = conversionRoutes.get(kind); if (convert === undefined) throw new Error("missing route"); const result = convert(inputs);
  const actual: number[] = []; for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected[kind]);
}
console.log("conversion-with-integers-map:ok");
