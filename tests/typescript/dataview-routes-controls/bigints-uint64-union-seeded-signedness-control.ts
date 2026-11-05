/*---
description: "Little-endian BigUint64 and BigInt64 reads interpret the same seeded bytes as exact unsigned and signed values. (control)"
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-unions, ts-narrowing, ts-objects, ts-strings, ts-readonly, ts-tuples, ts-destructuring]
---*/

function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localIndex(bytes: number[], offset: number): number {
  if (offset === Infinity || offset === -Infinity) throw new RangeError(); offset = offset !== offset ? 0 : offset - offset % 1;
  if (offset < 0 || offset + 8 > bytes.length) throw new RangeError(); return offset;
}
function localBigGet(bytes: number[], offset: number, signed: boolean, little = false): bigint {
  offset = localIndex(bytes, offset); let value = 0n; for (let i = 0; i < 8; i++) value = value * 256n + BigInt(bytes[offset + (little ? 7 - i : i)]);
  return signed && value >= 0x8000000000000000n ? value - 0x10000000000000000n : value;
}
function localGetBigInt64(bytes: number[], offset: number, little = false): bigint { return localBigGet(bytes, offset, true, little); }
function localGetBigUint64(bytes: number[], offset: number, little = false): bigint { return localBigGet(bytes, offset, false, little); }
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
// Little-endian BigUint64 and BigInt64 reads interpret the same seeded bytes as exact unsigned and signed values. Route: a discriminated union with distinct signed and unsigned View fields. Node prints bigints-uint64-union-seeded-signedness:ok.
type View = number[];
type ReadJob = { kind: "signed"; signed: View } | { kind: "unsigned"; unsigned: View };
function read(job: ReadJob): bigint {
  if (job.kind === "signed") return localGetBigInt64(job.signed, 0, true);
  return localGetBigUint64(job.unsigned, 0, true);
}
const rows: readonly [readonly number[], readonly bigint[]][] = [
  [[239, 205, 171, 137, 103, 69, 35, 1], [0x123456789abcdefn, 0x123456789abcdefn]],
  [[255, 255, 255, 255, 255, 255, 255, 127], [0x7fffffffffffffffn, 0x7fffffffffffffffn]],
  [[0, 0, 0, 0, 0, 0, 0, 128], [-0x8000000000000000n, 0x8000000000000000n]],
  [[1, 0, 0, 0, 0, 0, 0, 128], [-0x7fffffffffffffffn, 0x8000000000000001n]],
  [[255, 255, 255, 255, 255, 255, 255, 255], [-0x1n, 0xffffffffffffffffn]]
];
for (const [seed, expected] of rows) {
  const view: View = localDataView(localArrayBuffer(8)); for (let i = 0; i < 8; i++) localSetUint8(view, i, seed[i]);
  const jobs: readonly ReadJob[] = [{ kind: "signed", signed: view }, { kind: "unsigned", unsigned: view }];
  const actual: bigint[] = []; for (let i = 0; i < jobs.length; i++) actual[i] = read(jobs[i]);
  assert.compareArray(actual, expected);
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = localGetUint8(view, i); assert.compareArray(bytes, seed);
}
console.log("bigints-uint64-union-seeded-signedness:ok");
