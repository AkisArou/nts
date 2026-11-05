/*---
description: "Includes compares exact wide bigints without unsigned wrapping or loss of adjacent high values."
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-bigint, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-interfaces, ts-class, ts-class-fields, ts-this]
---*/

// Includes compares exact wide bigints without unsigned wrapping or loss of adjacent high values. Route: an interface implemented by signed and unsigned bigint stores. Node prints search-includes-interface-bigint-needle:ok.
type SignedSamples = BigInt64Array;
type UnsignedSamples = BigUint64Array;
interface SearchSource { contains(needle: bigint): boolean; }
class SignedSource implements SearchSource {
  data: SignedSamples = new BigInt64Array([9007199254740993n, -1n, 0n]);
  contains(needle: bigint): boolean { return this.data.includes(needle); }
}
class UnsignedSource implements SearchSource {
  data: UnsignedSamples = new BigUint64Array([9007199254740993n, 18446744073709551615n, 0n]);
  contains(needle: bigint): boolean { return this.data.includes(needle); }
}
const needles: readonly bigint[] = [9007199254740993n, 9007199254740992n, 18446744073709551615n, -1n, 0n, 18446744073709551616n, 2n];
const rows: readonly [SearchSource, readonly boolean[]][] = [
  [new SignedSource(), [true, false, false, true, true, false, false]],
  [new UnsignedSource(), [true, false, true, false, true, false, false]]
];
for (const [source, expected] of rows) for (let i = 0; i < needles.length; i++) assert.sameValue(source.contains(needles[i]), expected[i]);
console.log("search-includes-interface-bigint-needle:ok");
