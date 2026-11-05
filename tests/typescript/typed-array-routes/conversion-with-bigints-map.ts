/*---
description: "With converts every bigints element kind at its width, sign and precision boundaries."
features: [ts-typed-array-routes, ts-typed-array-route-conversion, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-bigint, ts-function-types, ts-arrow-functions, ts-map-set]
---*/

// With converts every bigints element kind at its width, sign and precision boundaries. Route: a callback read through guarded Map.get.
// Node prints conversion-with-bigints-map:ok.
type ConversionArray = BigInt64Array | BigUint64Array;
type ConvertValues = (values: readonly bigint[]) => ConversionArray;
const inputs: readonly bigint[] = [0n, -1n, 9223372036854775807n, 9223372036854775808n, -9223372036854775808n, -9223372036854775809n, 18446744073709551615n, 18446744073709551616n, 18446744073709551619n, 1267650600228229401496703205379n];
const writers: readonly ConvertValues[] = [
  values => { let data0 = new BigInt64Array(values.length); for (let i = 0; i < values.length; i++) data0 = data0.with(i, values[i]); return data0; },
  values => { let data1 = new BigUint64Array(values.length); for (let i = 0; i < values.length; i++) data1 = data1.with(i, values[i]); return data1; },
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
