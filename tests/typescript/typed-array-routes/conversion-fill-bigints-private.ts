/*---
description: "Fill converts every bigints element kind at its width, sign and precision boundaries."
features: [ts-typed-array-routes, ts-typed-array-route-conversion, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-bigint, ts-function-types, ts-arrow-functions, ts-class, ts-class-fields, ts-private-fields]
---*/

// Fill converts every bigints element kind at its width, sign and precision boundaries. Route: a private callback field.
// Node prints conversion-fill-bigints-private:ok.
type ConversionArray = BigInt64Array | BigUint64Array;
type ConvertValues = (values: readonly bigint[]) => ConversionArray;
const inputs: readonly bigint[] = [0n, -1n, 9223372036854775807n, 9223372036854775808n, -9223372036854775808n, -9223372036854775809n, 18446744073709551615n, 18446744073709551616n, 18446744073709551619n, 1267650600228229401496703205379n];
const writers: readonly ConvertValues[] = [
  values => { const data0 = new BigInt64Array(values.length); for (let i = 0; i < values.length; i++) data0.fill(values[i], i, i + 1); return data0; },
  values => { const data1 = new BigUint64Array(values.length); for (let i = 0; i < values.length; i++) data1.fill(values[i], i, i + 1); return data1; },
];
const expected: readonly (readonly bigint[])[] = [
  [0n, -1n, 9223372036854775807n, -9223372036854775808n, -9223372036854775808n, 9223372036854775807n, -1n, 0n, 3n, 3n],
  [0n, 18446744073709551615n, 9223372036854775807n, 9223372036854775808n, 9223372036854775808n, 9223372036854775807n, 18446744073709551615n, 0n, 3n, 3n],
];
class ConversionHolder { #run: ConvertValues; constructor(run: ConvertValues) { this.#run = run; } apply(values: readonly bigint[]): ConversionArray { return this.#run(values); } }
for (let kind = 0; kind < writers.length; kind++) {
  const holder = new ConversionHolder(writers[kind]), result = holder.apply(inputs);
  const actual: bigint[] = []; for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected[kind]);
}
console.log("conversion-fill-bigints-private:ok");
