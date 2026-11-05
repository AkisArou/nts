/*---
description: "Find returns the first exact bigint match and preserves the full visit prefix for both 64-bit kinds."
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-readonly, ts-unions, ts-null-undefined, ts-generics, ts-generic-constraints, ts-arrow-functions, ts-closures]
---*/

// Find returns the first exact bigint match and preserves the full visit prefix for both 64-bit kinds. Route: a constrained helper called at signed and unsigned bigint array type arguments. Node prints search-find-generic-bigint-visits:ok.
type SignedSamples = BigInt64Array;
type UnsignedSamples = BigUint64Array;
function inspect<T extends SignedSamples | UnsignedSamples>(data: T, needle: bigint, expected: bigint | undefined, expectedVisits: readonly (number | bigint)[]): void {
  const visits: (number | bigint)[] = [];
  const predicate = (value: bigint, index: number): boolean => { visits.push(index, value); return value === needle; };
  assert.sameValue(data.find(predicate), expected); assert.compareArray(visits, expectedVisits);
}
inspect<SignedSamples>(new BigInt64Array([-1n, 9007199254740993n, 3n, 9007199254740993n]), 9007199254740993n, 9007199254740993n, [0, -1n, 1, 9007199254740993n]);
inspect<UnsignedSamples>(new BigUint64Array([0n, 9223372036854775808n, 18446744073709551615n]), 18446744073709551615n, 18446744073709551615n, [0, 0n, 1, 9223372036854775808n, 2, 18446744073709551615n]);
inspect<SignedSamples>(new BigInt64Array([1n, -1n]), 2n, undefined, [0, 1n, 1, -1n]);
inspect<UnsignedSamples>(new BigUint64Array([]), 0n, undefined, []);
console.log("search-find-generic-bigint-visits:ok");
