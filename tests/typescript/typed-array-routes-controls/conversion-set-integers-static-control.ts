/*---
description: "Set converts every integers element kind at its width, sign and precision boundaries. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-conversion, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-function-types, ts-arrow-functions, ts-class, ts-class-fields, ts-static]
---*/

function localInteger(value: number, bits: number, signed: boolean): number { if (!Number.isFinite(value)) return 0; const modulus = 2 ** bits;
  const n = (Math.trunc(value) % modulus + modulus) % modulus; return signed && n >= modulus / 2 ? n - modulus : n; }
function localBuild(data: number | readonly number[], convert: (value: number) => number): number[] { const result: number[] = [];
  if (typeof data === "number") for (let i = 0; i < data; i++) result[i] = 0; else for (let i = 0; i < data.length; i++) result[i] = convert(data[i]); return result; }
function localSet(data: number[], values: readonly number[], convert: (value: number) => number): void { for (let i = 0; i < values.length; i++) data[i] = convert(values[i]); }
function localInt8Array(data: number | readonly number[]): number[] { return localBuild(data, value => localInteger(value, 8, true)); }
function localSetInt8Array(data: number[], values: readonly number[]): void { localSet(data, values, value => localInteger(value, 8, true)); }
function localUint8Array(data: number | readonly number[]): number[] { return localBuild(data, value => localInteger(value, 8, false)); }
function localSetUint8Array(data: number[], values: readonly number[]): void { localSet(data, values, value => localInteger(value, 8, false)); }
function localInt16Array(data: number | readonly number[]): number[] { return localBuild(data, value => localInteger(value, 16, true)); }
function localSetInt16Array(data: number[], values: readonly number[]): void { localSet(data, values, value => localInteger(value, 16, true)); }
function localUint16Array(data: number | readonly number[]): number[] { return localBuild(data, value => localInteger(value, 16, false)); }
function localSetUint16Array(data: number[], values: readonly number[]): void { localSet(data, values, value => localInteger(value, 16, false)); }
function localInt32Array(data: number | readonly number[]): number[] { return localBuild(data, value => localInteger(value, 32, true)); }
function localSetInt32Array(data: number[], values: readonly number[]): void { localSet(data, values, value => localInteger(value, 32, true)); }
function localUint32Array(data: number | readonly number[]): number[] { return localBuild(data, value => localInteger(value, 32, false)); }
function localSetUint32Array(data: number[], values: readonly number[]): void { localSet(data, values, value => localInteger(value, 32, false)); }
// Set converts every integers element kind at its width, sign and precision boundaries. Route: a reassigned static callback field.
// Node prints conversion-set-integers-static:ok.
type ConversionArray = number[];
type ConvertValues = (values: readonly number[]) => ConversionArray;
const inputs: readonly number[] = [0, -0, -1, 127, 128, -128, -129, 255, 256, 32767, 32768, -32768, -32769, 65535, 65536, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 4294967301, 3.9, -3.9, -0.9, NaN, Infinity, -Infinity];
const writers: readonly ConvertValues[] = [
  values => { const data0 = localInt8Array(values.length); localSetInt8Array(data0, values); return data0; },
  values => { const data1 = localUint8Array(values.length); localSetUint8Array(data1, values); return data1; },
  values => { const data2 = localInt16Array(values.length); localSetInt16Array(data2, values); return data2; },
  values => { const data3 = localUint16Array(values.length); localSetUint16Array(data3, values); return data3; },
  values => { const data4 = localInt32Array(values.length); localSetInt32Array(data4, values); return data4; },
  values => { const data5 = localUint32Array(values.length); localSetUint32Array(data5, values); return data5; },
];
const expected: readonly (readonly number[])[] = [
  [0, 0, -1, 127, -128, -128, 127, -1, 0, -1, 0, 0, -1, -1, 0, -1, 0, 0, -1, -1, 0, 5, 3, -3, 0, 0, 0, 0],
  [0, 0, 255, 127, 128, 128, 127, 255, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0, 255, 255, 0, 5, 3, 253, 0, 0, 0, 0],
  [0, 0, -1, 127, 128, -128, -129, 255, 256, 32767, -32768, -32768, 32767, -1, 0, -1, 0, 0, -1, -1, 0, 5, 3, -3, 0, 0, 0, 0],
  [0, 0, 65535, 127, 128, 65408, 65407, 255, 256, 32767, 32768, 32768, 32767, 65535, 0, 65535, 0, 0, 65535, 65535, 0, 5, 3, 65533, 0, 0, 0, 0],
  [0, 0, -1, 127, 128, -128, -129, 255, 256, 32767, 32768, -32768, -32769, 65535, 65536, 2147483647, -2147483648, -2147483648, 2147483647, -1, 0, 5, 3, -3, 0, 0, 0, 0],
  [0, 0, 4294967295, 127, 128, 4294967168, 4294967167, 255, 256, 32767, 32768, 4294934528, 4294934527, 65535, 65536, 2147483647, 2147483648, 2147483648, 2147483647, 4294967295, 0, 5, 3, 4294967293, 0, 0, 0, 0],
];
class ConversionDispatch { static run: ConvertValues = writers[0]; }
for (let kind = 0; kind < writers.length; kind++) {
  ConversionDispatch.run = writers[kind]; const result = ConversionDispatch.run(inputs);
  const actual: number[] = []; for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected[kind]);
}
console.log("conversion-set-integers-static:ok");
