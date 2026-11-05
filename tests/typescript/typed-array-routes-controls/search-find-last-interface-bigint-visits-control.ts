/*---
description: "FindLast keeps bigint values exact and records the reverse search in each store implementation. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-null-undefined, ts-interfaces, ts-class, ts-class-fields, ts-this, ts-arrow-functions, ts-closures]
---*/

function localBigInt64Array(input: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localBigUint64Array(input: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localFindLast<T extends number | bigint>(items: T[], predicate: (value: T, index: number, owner: T[]) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) { const value = items[i]; if (predicate(value, i, items)) return value; } return undefined;
}
// FindLast keeps bigint values exact and records the reverse search in each store implementation. Route: an interface implemented by signed and unsigned bigint stores. Node prints search-find-last-interface-bigint-visits:ok.
type SignedSamples = bigint[];
type UnsignedSamples = bigint[];
interface SearchSource { locate(needle: bigint, visits: (number | bigint)[]): bigint | undefined; }
class SignedSource implements SearchSource {
  data: SignedSamples = localBigInt64Array([-1n, 9007199254740993n, -1n, 7n]);
  locate(needle: bigint, visits: (number | bigint)[]): bigint | undefined {
    const predicate = (value: bigint, index: number): boolean => { visits.push(index, value); return value === needle; }; return localFindLast(this.data, predicate);
  }
}
class UnsignedSource implements SearchSource {
  data: UnsignedSamples = localBigUint64Array([18446744073709551615n, 9007199254740993n, 18446744073709551615n, 8n]);
  locate(needle: bigint, visits: (number | bigint)[]): bigint | undefined {
    const predicate = (value: bigint, index: number): boolean => { visits.push(index, value); return value === needle; }; return localFindLast(this.data, predicate);
  }
}
const rows: readonly [SearchSource, bigint, bigint | undefined, readonly (number | bigint)[]][] = [
  [new SignedSource(), -1n, -1n, [3, 7n, 2, -1n]],
  [new SignedSource(), 9007199254740993n, 9007199254740993n, [3, 7n, 2, -1n, 1, 9007199254740993n]],
  [new SignedSource(), 2n, undefined, [3, 7n, 2, -1n, 1, 9007199254740993n, 0, -1n]],
  [new UnsignedSource(), 18446744073709551615n, 18446744073709551615n, [3, 8n, 2, 18446744073709551615n]],
  [new UnsignedSource(), -1n, undefined, [3, 8n, 2, 18446744073709551615n, 1, 9007199254740993n, 0, 18446744073709551615n]],
  [new UnsignedSource(), 8n, 8n, [3, 8n]]
];
for (const [source, needle, expected, expectedVisits] of rows) {
  const visits: (number | bigint)[] = []; assert.sameValue(source.locate(needle, visits), expected); assert.compareArray(visits, expectedVisits);
}
console.log("search-find-last-interface-bigint-visits:ok");
