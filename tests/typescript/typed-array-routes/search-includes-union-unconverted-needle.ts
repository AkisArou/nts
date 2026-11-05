/*---
description: "Includes compares the original numeric needle without signed or unsigned element conversion."
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-discriminated-unions, ts-narrowing, ts-objects, ts-strings]
---*/

// Includes compares the original numeric needle without signed or unsigned element conversion. Route: a discriminated signed-byte or unsigned-byte array union. Node prints search-includes-union-unconverted-needle:ok.
type SignedSamples = Int8Array;
type UnsignedSamples = Uint8Array;
type SearchJob = { kind: "signed"; data: SignedSamples } | { kind: "unsigned"; data: UnsignedSamples };
function contains(job: SearchJob, needle: number): boolean {
  if (job.kind === "signed") return job.data.includes(needle);
  return job.data.includes(needle);
}
const needles: readonly number[] = [-1, 255, 256, 0, 1.9, 1, NaN, Infinity];
const rows: readonly [SearchJob, readonly boolean[]][] = [
  [{ kind: "signed", data: new Int8Array([-1, 0, 1, 127]) }, [true, false, false, true, false, true, false, false]],
  [{ kind: "unsigned", data: new Uint8Array([255, 0, 1, 128]) }, [false, true, false, true, false, true, false, false]]
];
for (const [job, expected] of rows) for (let i = 0; i < needles.length; i++) assert.sameValue(contains(job, needles[i]), expected[i]);
console.log("search-includes-union-unconverted-needle:ok");
