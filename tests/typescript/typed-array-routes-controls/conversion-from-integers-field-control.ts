/*---
description: "From converts every integers element kind at its width, sign and precision boundaries. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-conversion, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-function-types, ts-arrow-functions, ts-class, ts-class-fields]
---*/

function localInteger(value: number, bits: number, signed: boolean): number { if (!Number.isFinite(value)) return 0; const modulus = 2 ** bits;
  const n = (Math.trunc(value) % modulus + modulus) % modulus; return signed && n >= modulus / 2 ? n - modulus : n; }
function localBuild(data: number | readonly number[], convert: (value: number) => number): number[] { const result: number[] = [];
  if (typeof data === "number") for (let i = 0; i < data; i++) result[i] = 0; else for (let i = 0; i < data.length; i++) result[i] = convert(data[i]); return result; }
function localFromInt8Array(values: readonly number[]): number[] { return localBuild(values, value => localInteger(value, 8, true)); }
function localFromUint8Array(values: readonly number[]): number[] { return localBuild(values, value => localInteger(value, 8, false)); }
function localFromInt16Array(values: readonly number[]): number[] { return localBuild(values, value => localInteger(value, 16, true)); }
function localFromUint16Array(values: readonly number[]): number[] { return localBuild(values, value => localInteger(value, 16, false)); }
function localFromInt32Array(values: readonly number[]): number[] { return localBuild(values, value => localInteger(value, 32, true)); }
function localFromUint32Array(values: readonly number[]): number[] { return localBuild(values, value => localInteger(value, 32, false)); }
// From converts every integers element kind at its width, sign and precision boundaries. Route: a declared callback field.
// Node prints conversion-from-integers-field:ok.
type ConversionArray = number[];
type ConvertValues = (values: readonly number[]) => ConversionArray;
const inputs: readonly number[] = [0, -0, -1, 127, 128, -128, -129, 255, 256, 32767, 32768, -32768, -32769, 65535, 65536, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 4294967301, 3.9, -3.9, -0.9, NaN, Infinity, -Infinity];
const writers: readonly ConvertValues[] = [
  values => localFromInt8Array(values),
  values => localFromUint8Array(values),
  values => localFromInt16Array(values),
  values => localFromUint16Array(values),
  values => localFromInt32Array(values),
  values => localFromUint32Array(values),
];
const expected: readonly (readonly number[])[] = [
  [0, 0, -1, 127, -128, -128, 127, -1, 0, -1, 0, 0, -1, -1, 0, -1, 0, 0, -1, -1, 0, 5, 3, -3, 0, 0, 0, 0],
  [0, 0, 255, 127, 128, 128, 127, 255, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0, 255, 255, 0, 5, 3, 253, 0, 0, 0, 0],
  [0, 0, -1, 127, 128, -128, -129, 255, 256, 32767, -32768, -32768, 32767, -1, 0, -1, 0, 0, -1, -1, 0, 5, 3, -3, 0, 0, 0, 0],
  [0, 0, 65535, 127, 128, 65408, 65407, 255, 256, 32767, 32768, 32768, 32767, 65535, 0, 65535, 0, 0, 65535, 65535, 0, 5, 3, 65533, 0, 0, 0, 0],
  [0, 0, -1, 127, 128, -128, -129, 255, 256, 32767, 32768, -32768, -32769, 65535, 65536, 2147483647, -2147483648, -2147483648, 2147483647, -1, 0, 5, 3, -3, 0, 0, 0, 0],
  [0, 0, 4294967295, 127, 128, 4294967168, 4294967167, 255, 256, 32767, 32768, 4294934528, 4294934527, 65535, 65536, 2147483647, 2147483648, 2147483648, 2147483647, 4294967295, 0, 5, 3, 4294967293, 0, 0, 0, 0],
];
class ConversionHolder { run: ConvertValues; constructor(run: ConvertValues) { this.run = run; } }
for (let kind = 0; kind < writers.length; kind++) {
  const holder = new ConversionHolder(writers[kind]), result = holder.run(inputs);
  const actual: number[] = []; for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected[kind]);
}
console.log("conversion-from-integers-field:ok");
