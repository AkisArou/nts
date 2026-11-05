/*---
description: "Includes compares the original numeric needle without signed or unsigned element conversion. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-discriminated-unions, ts-narrowing, ts-objects, ts-strings]
---*/

function localInt8Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localUint8Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localInteger(value: number): number { return value !== value ? 0 : value === Infinity || value === -Infinity ? value : value - value % 1; }
function localIncludes<T extends number | bigint>(items: readonly T[], needle: T, fromIndex = 0): boolean {
  let first = localInteger(fromIndex); if (first < 0) first += items.length; if (first < 0) first = 0;
  for (let i = first; i < items.length; i++) if (items[i] === needle || items[i] !== items[i] && needle !== needle) return true; return false;
}
// Includes compares the original numeric needle without signed or unsigned element conversion. Route: a discriminated signed-byte or unsigned-byte array union. Node prints search-includes-union-unconverted-needle:ok.
type SignedSamples = number[];
type UnsignedSamples = number[];
type SearchJob = { kind: "signed"; data: SignedSamples } | { kind: "unsigned"; data: UnsignedSamples };
function contains(job: SearchJob, needle: number): boolean {
  if (job.kind === "signed") return localIncludes(job.data, needle);
  return localIncludes(job.data, needle);
}
const needles: readonly number[] = [-1, 255, 256, 0, 1.9, 1, NaN, Infinity];
const rows: readonly [SearchJob, readonly boolean[]][] = [
  [{ kind: "signed", data: localInt8Array([-1, 0, 1, 127]) }, [true, false, false, true, false, true, false, false]],
  [{ kind: "unsigned", data: localUint8Array([255, 0, 1, 128]) }, [false, true, false, true, false, true, false, false]]
];
for (const [job, expected] of rows) for (let i = 0; i < needles.length; i++) assert.sameValue(contains(job, needles[i]), expected[i]);
console.log("search-includes-union-unconverted-needle:ok");
