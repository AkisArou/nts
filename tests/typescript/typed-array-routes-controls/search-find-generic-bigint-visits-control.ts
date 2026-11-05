/*---
description: "Find returns the first exact bigint match and preserves the full visit prefix for both 64-bit kinds. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-readonly, ts-unions, ts-null-undefined, ts-generics, ts-generic-constraints, ts-arrow-functions, ts-closures]
---*/

function localBigInt64Array(input: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localBigUint64Array(input: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localFind<T extends number | bigint>(items: T[], predicate: (value: T, index: number, owner: T[]) => boolean): T | undefined {
  for (let i = 0, length = items.length; i < length; i++) { const value = items[i]; if (predicate(value, i, items)) return value; } return undefined;
}
// Find returns the first exact bigint match and preserves the full visit prefix for both 64-bit kinds. Route: a constrained helper called at signed and unsigned bigint array type arguments. Node prints search-find-generic-bigint-visits:ok.
type SignedSamples = bigint[];
type UnsignedSamples = bigint[];
function inspect<T extends SignedSamples | UnsignedSamples>(data: T, needle: bigint, expected: bigint | undefined, expectedVisits: readonly (number | bigint)[]): void {
  const visits: (number | bigint)[] = [];
  const predicate = (value: bigint, index: number): boolean => { visits.push(index, value); return value === needle; };
  assert.sameValue(localFind(data, predicate), expected); assert.compareArray(visits, expectedVisits);
}
inspect<SignedSamples>(localBigInt64Array([-1n, 9007199254740993n, 3n, 9007199254740993n]), 9007199254740993n, 9007199254740993n, [0, -1n, 1, 9007199254740993n]);
inspect<UnsignedSamples>(localBigUint64Array([0n, 9223372036854775808n, 18446744073709551615n]), 18446744073709551615n, 18446744073709551615n, [0, 0n, 1, 9223372036854775808n, 2, 18446744073709551615n]);
inspect<SignedSamples>(localBigInt64Array([1n, -1n]), 2n, undefined, [0, 1n, 1, -1n]);
inspect<UnsignedSamples>(localBigUint64Array([]), 0n, undefined, []);
console.log("search-find-generic-bigint-visits:ok");
