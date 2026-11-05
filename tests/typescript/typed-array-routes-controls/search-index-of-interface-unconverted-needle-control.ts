/*---
description: "IndexOf does not wrap or truncate needles when either integer-store implementation searches. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-interfaces, ts-class, ts-class-fields, ts-this]
---*/

function localInt16Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localUint16Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localInteger(value: number): number { return value !== value ? 0 : value === Infinity || value === -Infinity ? value : value - value % 1; }
function localIndexOf<T extends number | bigint>(items: readonly T[], needle: T, fromIndex = 0): number {
  let first = localInteger(fromIndex); if (first < 0) first += items.length; if (first < 0) first = 0;
  for (let i = first; i < items.length; i++) if (items[i] === needle) return i; return -1;
}
// IndexOf does not wrap or truncate needles when either integer-store implementation searches. Route: an interface implemented by signed-word and unsigned-word stores. Node prints search-index-of-interface-unconverted-needle:ok.
type SignedSamples = number[];
type UnsignedSamples = number[];
interface SearchSource { locate(needle: number): number; }
class SignedSource implements SearchSource {
  data: SignedSamples = localInt16Array([-1, 1, 32767]);
  locate(needle: number): number { return localIndexOf(this.data, needle); }
}
class UnsignedSource implements SearchSource {
  data: UnsignedSamples = localUint16Array([65535, 1, 32768]);
  locate(needle: number): number { return localIndexOf(this.data, needle); }
}
const needles: readonly number[] = [-1, 65535, 65536, 1.9, 1, 32768, -32768, NaN, Infinity];
const rows: readonly [SearchSource, readonly number[]][] = [
  [new SignedSource(), [0, -1, -1, -1, 1, -1, -1, -1, -1]],
  [new UnsignedSource(), [-1, 0, -1, -1, 1, 2, -1, -1, -1]]
];
for (const [source, expected] of rows) for (let i = 0; i < needles.length; i++) assert.sameValue(source.locate(needles[i]), expected[i]);
console.log("search-index-of-interface-unconverted-needle:ok");
