/*---
description: "From converts every bigints element kind at its width, sign and precision boundaries. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-conversion, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-bigint, ts-function-types, ts-arrow-functions, ts-class, ts-class-fields]
---*/

function localBig(value: bigint, signed: boolean): bigint {
  const modulus = 2n ** 64n, n = (value % modulus + modulus) % modulus;
  return signed && n >= 2n ** 63n ? n - modulus : n;
}
function localBuild(data: number | readonly bigint[], convert: (value: bigint) => bigint): bigint[] { const result: bigint[] = [];
  if (typeof data === "number") for (let i = 0; i < data; i++) result[i] = 0n; else for (let i = 0; i < data.length; i++) result[i] = convert(data[i]); return result; }
function localFromBigInt64Array(values: readonly bigint[]): bigint[] { return localBuild(values, value => localBig(value, true)); }
function localFromBigUint64Array(values: readonly bigint[]): bigint[] { return localBuild(values, value => localBig(value, false)); }
// From converts every bigints element kind at its width, sign and precision boundaries. Route: a declared callback field.
// Node prints conversion-from-bigints-field:ok.
type ConversionArray = bigint[];
type ConvertValues = (values: readonly bigint[]) => ConversionArray;
const inputs: readonly bigint[] = [0n, -1n, 9223372036854775807n, 9223372036854775808n, -9223372036854775808n, -9223372036854775809n, 18446744073709551615n, 18446744073709551616n, 18446744073709551619n, 1267650600228229401496703205379n];
const writers: readonly ConvertValues[] = [
  values => localFromBigInt64Array(values),
  values => localFromBigUint64Array(values),
];
const expected: readonly (readonly bigint[])[] = [
  [0n, -1n, 9223372036854775807n, -9223372036854775808n, -9223372036854775808n, 9223372036854775807n, -1n, 0n, 3n, 3n],
  [0n, 18446744073709551615n, 9223372036854775807n, 9223372036854775808n, 9223372036854775808n, 9223372036854775807n, 18446744073709551615n, 0n, 3n, 3n],
];
class ConversionHolder { run: ConvertValues; constructor(run: ConvertValues) { this.run = run; } }
for (let kind = 0; kind < writers.length; kind++) {
  const holder = new ConversionHolder(writers[kind]), result = holder.run(inputs);
  const actual: bigint[] = []; for (let i = 0; i < result.length; i++) actual[i] = result[i];
  assert.compareArray(actual, expected[kind]);
}
console.log("conversion-from-bigints-field:ok");
