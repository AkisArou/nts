/*---
description: "FindLastIndex locates the final exact bigint match without losing high bits and records all reverse visits. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-discriminated-unions, ts-narrowing, ts-objects, ts-strings, ts-arrow-functions, ts-closures]
---*/

function localBigInt64Array(input: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localBigUint64Array(input: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localFindLastIndex<T extends number | bigint>(items: T[], predicate: (value: T, index: number, owner: T[]) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (predicate(items[i], i, items)) return i; return -1;
}
// FindLastIndex locates the final exact bigint match without losing high bits and records all reverse visits. Route: a discriminated union of signed and unsigned bigint arrays. Node prints search-find-last-index-union-bigint-visits:ok.
type SignedSamples = bigint[];
type UnsignedSamples = bigint[];
type SearchJob = { kind: "signed"; data: SignedSamples } | { kind: "unsigned"; data: UnsignedSamples };
function locate(job: SearchJob, needle: bigint, visits: (number | bigint)[]): number {
  const predicate = (value: bigint, index: number): boolean => { visits.push(index, value); return value === needle; };
  if (job.kind === "signed") return localFindLastIndex(job.data, predicate);
  return localFindLastIndex(job.data, predicate);
}
const signed: SearchJob = { kind: "signed", data: localBigInt64Array([-1n, 9n, -1n, -9223372036854775808n]) };
const unsigned: SearchJob = { kind: "unsigned", data: localBigUint64Array([18446744073709551615n, 9n, 18446744073709551615n, 9223372036854775808n]) };
const rows: readonly [SearchJob, bigint, number, readonly (number | bigint)[]][] = [
  [signed, -1n, 2, [3, -9223372036854775808n, 2, -1n]], [signed, -9223372036854775808n, 3, [3, -9223372036854775808n]],
  [unsigned, 18446744073709551615n, 2, [3, 9223372036854775808n, 2, 18446744073709551615n]],
  [unsigned, 9n, 1, [3, 9223372036854775808n, 2, 18446744073709551615n, 1, 9n]],
  [signed, 0n, -1, [3, -9223372036854775808n, 2, -1n, 1, 9n, 0, -1n]],
  [unsigned, -1n, -1, [3, 9223372036854775808n, 2, 18446744073709551615n, 1, 9n, 0, 18446744073709551615n]],
  [{ kind: "signed", data: localBigInt64Array([]) }, 0n, -1, []]
];
for (const [job, needle, expected, expectedVisits] of rows) {
  const visits: (number | bigint)[] = []; assert.sameValue(locate(job, needle, visits), expected); assert.compareArray(visits, expectedVisits);
}
console.log("search-find-last-index-union-bigint-visits:ok");
