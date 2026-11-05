/*---
description: "LastIndexOf keeps fractional and out-of-kind needles unchanged while selecting the last duplicate."
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-generics, ts-generic-constraints, ts-unions]
---*/

// LastIndexOf keeps fractional and out-of-kind needles unchanged while selecting the last duplicate. Route: a constrained helper called at signed-byte and unsigned-byte type arguments. Node prints search-last-index-of-generic-unconverted-needle:ok.
type SignedSamples = Int8Array;
type UnsignedSamples = Uint8Array;
const needles: readonly number[] = [-1, 255, 511, -257, 1.9, 1, NaN, Infinity];
function inspect<T extends SignedSamples | UnsignedSamples>(data: T, expected: readonly number[]): void {
  for (let i = 0; i < needles.length; i++) assert.sameValue(data.lastIndexOf(needles[i]), expected[i]);
}
inspect<SignedSamples>(new Int8Array([-1, 0, 1, -1]), [3, -1, -1, -1, -1, 2, -1, -1]);
inspect<UnsignedSamples>(new Uint8Array([255, 0, 1, 255]), [-1, 3, -1, -1, -1, 2, -1, -1]);
console.log("search-last-index-of-generic-unconverted-needle:ok");
