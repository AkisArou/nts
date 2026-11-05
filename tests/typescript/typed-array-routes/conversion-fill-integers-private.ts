/*---
description: "Fill converts every integers element kind at its width, sign and precision boundaries."
features: [ts-typed-array-routes, ts-typed-array-route-conversion, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-function-types, ts-arrow-functions, ts-class, ts-class-fields, ts-private-fields]
---*/

// Fill converts every integers element kind at its width, sign and precision boundaries. Route: a private callback field.
// Node prints conversion-fill-integers-private:ok.
type ConversionArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array;
type ConvertValues = (values: readonly number[]) => ConversionArray;
const inputs: readonly number[] = [0, -0, -1, 127, 128, -128, -129, 255, 256, 32767, 32768, -32768, -32769, 65535, 65536, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 4294967301, 3.9, -3.9, -0.9, NaN, Infinity, -Infinity];
const writers: readonly ConvertValues[] = [
  values => { const data0 = new Int8Array(values.length); for (let i = 0; i < values.length; i++) data0.fill(values[i], i, i + 1); return data0; },
  values => { const data1 = new Uint8Array(values.length); for (let i = 0; i < values.length; i++) data1.fill(values[i], i, i + 1); return data1; },
  values => { const data2 = new Int16Array(values.length); for (let i = 0; i < values.length; i++) data2.fill(values[i], i, i + 1); return data2; },
  values => { const data3 = new Uint16Array(values.length); for (let i = 0; i < values.length; i++) data3.fill(values[i], i, i + 1); return data3; },
  values => { const data4 = new Int32Array(values.length); for (let i = 0; i < values.length; i++) data4.fill(values[i], i, i + 1); return data4; },
  values => { const data5 = new Uint32Array(values.length); for (let i = 0; i < values.length; i++) data5.fill(values[i], i, i + 1); return data5; },
];
const expected: readonly (readonly number[])[] = [
  [0, 0, -1, 127, -128, -128, 127, -1, 0, -1, 0, 0, -1, -1, 0, -1, 0, 0, -1, -1, 0, 5, 3, -3, 0, 0, 0, 0],
  [0, 0, 255, 127, 128, 128, 127, 255, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0, 255, 255, 0, 5, 3, 253, 0, 0, 0, 0],
  [0, 0, -1, 127, 128, -128, -129, 255, 256, 32767, -32768, -32768, 32767, -1, 0, -1, 0, 0, -1, -1, 0, 5, 3, -3, 0, 0, 0, 0],
  [0, 0, 65535, 127, 128, 65408, 65407, 255, 256, 32767, 32768, 32768, 32767, 65535, 0, 65535, 0, 0, 65535, 65535, 0, 5, 3, 65533, 0, 0, 0, 0],
  [0, 0, -1, 127, 128, -128, -129, 255, 256, 32767, 32768, -32768, -32769, 65535, 65536, 2147483647, -2147483648, -2147483648, 2147483647, -1, 0, 5, 3, -3, 0, 0, 0, 0],
  [0, 0, 4294967295, 127, 128, 4294967168, 4294967167, 255, 256, 32767, 32768, 4294934528, 4294934527, 65535, 65536, 2147483647, 2147483648, 2147483648, 2147483647, 4294967295, 0, 5, 3, 4294967293, 0, 0, 0, 0],
];
class ConversionHolder { #run: ConvertValues; constructor(run: ConvertValues) { this.#run = run; } apply(values: readonly number[]): ConversionArray { return this.#run(values); } }
for (let kind = 0; kind < writers.length; kind++) {
  const holder = new ConversionHolder(writers[kind]), result = holder.apply(inputs);
  const actual: number[] = []; for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected[kind]);
}
console.log("conversion-fill-integers-private:ok");
