/*---
description: "Map converts every bigints element kind at its width, sign and precision boundaries."
features: [ts-typed-array-routes, ts-typed-array-route-conversion, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-bigint, ts-function-types, ts-arrow-functions, ts-generics, ts-generic-constraints, ts-objects]
---*/

// Map converts every bigints element kind at its width, sign and precision boundaries. Route: a constrained input helper at two type arguments.
// Node prints conversion-map-bigints-generic:ok.
type ConversionArray = BigInt64Array | BigUint64Array;
type ConvertValues = (values: readonly bigint[]) => ConversionArray;
const inputs: readonly bigint[] = [0n, -1n, 9223372036854775807n, 9223372036854775808n, -9223372036854775808n, -9223372036854775809n, 18446744073709551615n, 18446744073709551616n, 18446744073709551619n, 1267650600228229401496703205379n];
const writers: readonly ConvertValues[] = [
  values => { const data0 = new BigInt64Array(values.length); return data0.map((_value, index) => values[index]); },
  values => { const data1 = new BigUint64Array(values.length); return data1.map((_value, index) => values[index]); },
];
const expected: readonly (readonly bigint[])[] = [
  [0n, -1n, 9223372036854775807n, -9223372036854775808n, -9223372036854775808n, 9223372036854775807n, -1n, 0n, 3n, 3n],
  [0n, 18446744073709551615n, 9223372036854775807n, 9223372036854775808n, 9223372036854775808n, 9223372036854775807n, 18446744073709551615n, 0n, 3n, 3n],
];
type InputValues = { values: readonly bigint[] }; type LabeledInput = { values: readonly bigint[]; label: string };
function applyValues<T extends InputValues>(plan: T, convert: ConvertValues): ConversionArray { return convert(plan.values); }
for (let kind = 0; kind < writers.length; kind++) {
  const results = [applyValues<InputValues>({ values: inputs }, writers[kind]), applyValues<LabeledInput>({ values: inputs, label: "again" }, writers[kind])]; for (const result of results) {
  const actual: bigint[] = []; for (let i = 0; i < result.length; i++) actual[i] = result[i]; assert.compareArray(actual, expected[kind]); }
}
console.log("conversion-map-bigints-generic:ok");
