/*---
description: "Includes compares exact wide bigints without unsigned wrapping or loss of adjacent high values. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-bigint, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-interfaces, ts-class, ts-class-fields, ts-this]
---*/

function localBigInt64Array(input: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localBigUint64Array(input: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localInteger(value: number): number { return value !== value ? 0 : value === Infinity || value === -Infinity ? value : value - value % 1; }
function localIncludes<T extends number | bigint>(items: readonly T[], needle: T, fromIndex = 0): boolean {
  let first = localInteger(fromIndex); if (first < 0) first += items.length; if (first < 0) first = 0;
  for (let i = first; i < items.length; i++) if (items[i] === needle || items[i] !== items[i] && needle !== needle) return true; return false;
}
// Includes compares exact wide bigints without unsigned wrapping or loss of adjacent high values. Route: an interface implemented by signed and unsigned bigint stores. Node prints search-includes-interface-bigint-needle:ok.
type SignedSamples = bigint[];
type UnsignedSamples = bigint[];
interface SearchSource { contains(needle: bigint): boolean; }
class SignedSource implements SearchSource {
  data: SignedSamples = localBigInt64Array([9007199254740993n, -1n, 0n]);
  contains(needle: bigint): boolean { return localIncludes(this.data, needle); }
}
class UnsignedSource implements SearchSource {
  data: UnsignedSamples = localBigUint64Array([9007199254740993n, 18446744073709551615n, 0n]);
  contains(needle: bigint): boolean { return localIncludes(this.data, needle); }
}
const needles: readonly bigint[] = [9007199254740993n, 9007199254740992n, 18446744073709551615n, -1n, 0n, 18446744073709551616n, 2n];
const rows: readonly [SearchSource, readonly boolean[]][] = [
  [new SignedSource(), [true, false, false, true, true, false, false]],
  [new UnsignedSource(), [true, false, true, false, true, false, false]]
];
for (const [source, expected] of rows) for (let i = 0; i < needles.length; i++) assert.sameValue(source.contains(needles[i]), expected[i]);
console.log("search-includes-interface-bigint-needle:ok");
