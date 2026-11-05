/*---
description: "Seeded Uint16 bytes retain their unsigned magnitudes and select the requested order separately from the signed interpretation."
features: [ts-dataview-routes, ts-dataview-route-integers, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-unions, ts-narrowing, ts-objects, ts-strings, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Seeded Uint16 bytes retain their unsigned magnitudes and select the requested order separately from the signed interpretation. Route: a discriminated signed-or-unsigned reader job. Node prints integers-uint16-union-seeded-endian:ok.
type View = DataView;
type ReadJob = { kind: "unsigned"; little: boolean } | { kind: "signed"; little: boolean };
function read(job: ReadJob, view: View): number {
  if (job.kind === "unsigned") return view.getUint16(0, job.little);
  return view.getInt16(0, job.little);
}
const jobs: readonly ReadJob[] = [
  { kind: "unsigned", little: false }, { kind: "unsigned", little: true },
  { kind: "signed", little: false }, { kind: "signed", little: true }
];
const rows: readonly [readonly number[], readonly number[]][] = [
  [[18, 52], [4660, 13330, 4660, 13330]], [[128, 255], [33023, 65408, -32513, -128]],
  [[255, 127], [65407, 32767, -129, 32767]], [[1, 128], [384, 32769, 384, -32767]]
];
for (const [seed, expected] of rows) {
  const view: View = new DataView(new ArrayBuffer(2)); for (let i = 0; i < 2; i++) view.setUint8(i, seed[i]);
  const actual: number[] = []; for (let i = 0; i < jobs.length; i++) actual[i] = read(jobs[i], view);
  assert.compareArray(actual, expected);
  const bytes: number[] = []; for (let i = 0; i < 2; i++) bytes[i] = view.getUint8(i); assert.compareArray(bytes, seed);
}
console.log("integers-uint16-union-seeded-endian:ok");
