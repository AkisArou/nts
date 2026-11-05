/*---
description: "With converts every bigints element kind at its width, sign and precision boundaries. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-conversion, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-bigint, ts-function-types, ts-arrow-functions, ts-map-set]
---*/

function localBig(value: bigint, signed: boolean): bigint {
  const modulus = 2n ** 64n, n = (value % modulus + modulus) % modulus;
  return signed && n >= 2n ** 63n ? n - modulus : n;
}
function localBuild(data: number | readonly bigint[], convert: (value: bigint) => bigint): bigint[] { const result: bigint[] = [];
  if (typeof data === "number") for (let i = 0; i < data; i++) result[i] = 0n; else for (let i = 0; i < data.length; i++) result[i] = convert(data[i]); return result; }
function localWith(data: bigint[], index: number, value: bigint, convert: (value: bigint) => bigint): bigint[] { const result: bigint[] = []; for (let i = 0; i < data.length; i++) result[i] = i === index ? convert(value) : data[i]; return result; }
function localBigInt64Array(data: number | readonly bigint[]): bigint[] { return localBuild(data, value => localBig(value, true)); }
function localWithBigInt64Array(data: bigint[], index: number, value: bigint): bigint[] { return localWith(data, index, value, value => localBig(value, true)); }
function localBigUint64Array(data: number | readonly bigint[]): bigint[] { return localBuild(data, value => localBig(value, false)); }
function localWithBigUint64Array(data: bigint[], index: number, value: bigint): bigint[] { return localWith(data, index, value, value => localBig(value, false)); }
// With converts every bigints element kind at its width, sign and precision boundaries. Route: a callback read through guarded Map.get.
// Node prints conversion-with-bigints-map:ok.
type ConversionArray = bigint[];
type ConvertValues = (values: readonly bigint[]) => ConversionArray;
const inputs: readonly bigint[] = [0n, -1n, 9223372036854775807n, 9223372036854775808n, -9223372036854775808n, -9223372036854775809n, 18446744073709551615n, 18446744073709551616n, 18446744073709551619n, 1267650600228229401496703205379n];
const writers: readonly ConvertValues[] = [
  values => { let data0 = localBigInt64Array(values.length); for (let i = 0; i < values.length; i++) data0 = localWithBigInt64Array(data0, i, values[i]); return data0; },
  values => { let data1 = localBigUint64Array(values.length); for (let i = 0; i < values.length; i++) data1 = localWithBigUint64Array(data1, i, values[i]); return data1; },
];
const expected: readonly (readonly bigint[])[] = [
  [0n, -1n, 9223372036854775807n, -9223372036854775808n, -9223372036854775808n, 9223372036854775807n, -1n, 0n, 3n, 3n],
  [0n, 18446744073709551615n, 9223372036854775807n, 9223372036854775808n, 9223372036854775808n, 9223372036854775807n, 18446744073709551615n, 0n, 3n, 3n],
];
const conversionRoutes: Map<number, ConvertValues> = new Map(); for (let i = 0; i < writers.length; i++) conversionRoutes.set(i, writers[i]);
for (let kind = 0; kind < writers.length; kind++) {
  const convert = conversionRoutes.get(kind); if (convert === undefined) throw new Error("missing route"); const result = convert(inputs);
  const actual: bigint[] = []; for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected[kind]);
}
console.log("conversion-with-bigints-map:ok");
