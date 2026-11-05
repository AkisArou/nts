/*---
description: "IndexOf does not wrap or truncate needles when either integer-store implementation searches."
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-interfaces, ts-class, ts-class-fields, ts-this]
---*/

// IndexOf does not wrap or truncate needles when either integer-store implementation searches. Route: an interface implemented by signed-word and unsigned-word stores. Node prints search-index-of-interface-unconverted-needle:ok.
type SignedSamples = Int16Array;
type UnsignedSamples = Uint16Array;
interface SearchSource { locate(needle: number): number; }
class SignedSource implements SearchSource {
  data: SignedSamples = new Int16Array([-1, 1, 32767]);
  locate(needle: number): number { return this.data.indexOf(needle); }
}
class UnsignedSource implements SearchSource {
  data: UnsignedSamples = new Uint16Array([65535, 1, 32768]);
  locate(needle: number): number { return this.data.indexOf(needle); }
}
const needles: readonly number[] = [-1, 65535, 65536, 1.9, 1, 32768, -32768, NaN, Infinity];
const rows: readonly [SearchSource, readonly number[]][] = [
  [new SignedSource(), [0, -1, -1, -1, 1, -1, -1, -1, -1]],
  [new UnsignedSource(), [-1, 0, -1, -1, 1, 2, -1, -1, -1]]
];
for (const [source, expected] of rows) for (let i = 0; i < needles.length; i++) assert.sameValue(source.locate(needles[i]), expected[i]);
console.log("search-index-of-interface-unconverted-needle:ok");
