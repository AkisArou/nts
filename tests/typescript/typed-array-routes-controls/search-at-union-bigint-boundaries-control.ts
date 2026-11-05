/*---
description: "At keeps signed and unsigned high bigint values exact and returns undefined outside the selected array. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-discriminated-unions, ts-narrowing, ts-objects, ts-strings, ts-null-undefined]
---*/

function localBigInt64Array(input: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localBigUint64Array(input: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localInteger(value: number): number { return value !== value ? 0 : value === Infinity || value === -Infinity ? value : value - value % 1; }
function localAt<T extends number | bigint>(items: readonly T[], index: number): T | undefined {
  let position = localInteger(index); if (position < 0) position += items.length;
  for (let i = 0; i < items.length; i++) if (i === position) return items[i]; return undefined;
}
// At keeps signed and unsigned high bigint values exact and returns undefined outside the selected array. Route: a discriminated union of signed and unsigned bigint arrays. Node prints search-at-union-bigint-boundaries:ok.
type SignedSamples = bigint[];
type UnsignedSamples = bigint[];
type SearchJob = { kind: "signed"; data: SignedSamples } | { kind: "unsigned"; data: UnsignedSamples };
function read(job: SearchJob, index: number): bigint | undefined {
  if (job.kind === "signed") return localAt(job.data, index);
  return localAt(job.data, index);
}
const indexes: readonly number[] = [-4, -3, -1, 0, 1.9, 2, 3];
const rows: readonly [SearchJob, readonly (bigint | undefined)[]][] = [
  [{ kind: "signed", data: localBigInt64Array([-9223372036854775808n, -1n, 9007199254740993n]) }, [undefined, -9223372036854775808n, 9007199254740993n, -9223372036854775808n, -1n, 9007199254740993n, undefined]],
  [{ kind: "unsigned", data: localBigUint64Array([9223372036854775808n, 18446744073709551615n, 9007199254740993n]) }, [undefined, 9223372036854775808n, 9007199254740993n, 9223372036854775808n, 18446744073709551615n, 9007199254740993n, undefined]]
];
for (const [job, expected] of rows) for (let i = 0; i < indexes.length; i++) assert.sameValue(read(job, indexes[i]), expected[i]);
console.log("search-at-union-bigint-boundaries:ok");
