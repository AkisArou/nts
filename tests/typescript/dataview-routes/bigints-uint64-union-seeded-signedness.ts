/*---
description: "Little-endian BigUint64 and BigInt64 reads interpret the same seeded bytes as exact unsigned and signed values."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-unions, ts-narrowing, ts-objects, ts-strings, ts-readonly, ts-tuples, ts-destructuring]
---*/

// Little-endian BigUint64 and BigInt64 reads interpret the same seeded bytes as exact unsigned and signed values. Route: a discriminated union with distinct signed and unsigned View fields. Node prints bigints-uint64-union-seeded-signedness:ok.
type View = DataView;
type ReadJob = { kind: "signed"; signed: View } | { kind: "unsigned"; unsigned: View };
function read(job: ReadJob): bigint {
  if (job.kind === "signed") return job.signed.getBigInt64(0, true);
  return job.unsigned.getBigUint64(0, true);
}
const rows: readonly [readonly number[], readonly bigint[]][] = [
  [[239, 205, 171, 137, 103, 69, 35, 1], [0x123456789abcdefn, 0x123456789abcdefn]],
  [[255, 255, 255, 255, 255, 255, 255, 127], [0x7fffffffffffffffn, 0x7fffffffffffffffn]],
  [[0, 0, 0, 0, 0, 0, 0, 128], [-0x8000000000000000n, 0x8000000000000000n]],
  [[1, 0, 0, 0, 0, 0, 0, 128], [-0x7fffffffffffffffn, 0x8000000000000001n]],
  [[255, 255, 255, 255, 255, 255, 255, 255], [-0x1n, 0xffffffffffffffffn]]
];
for (const [seed, expected] of rows) {
  const view: View = new DataView(new ArrayBuffer(8)); for (let i = 0; i < 8; i++) view.setUint8(i, seed[i]);
  const jobs: readonly ReadJob[] = [{ kind: "signed", signed: view }, { kind: "unsigned", unsigned: view }];
  const actual: bigint[] = []; for (let i = 0; i < jobs.length; i++) actual[i] = read(jobs[i]);
  assert.compareArray(actual, expected);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = view.getUint8(i); assert.compareArray(bytes, seed);
}
console.log("bigints-uint64-union-seeded-signedness:ok");
