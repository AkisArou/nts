/*---
description: "A failed BigUint64 write leaves every byte unchanged in both byte orders and a valid final-word write preserves the leading bytes. (control)"
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-unions, ts-narrowing, ts-objects, ts-strings, ts-readonly, ts-errors, ts-arrow-functions]
---*/

function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(bytes: number[]): number[] { return bytes; }
function localIndex(bytes: number[], offset: number): number {
  if (offset === Infinity || offset === -Infinity) throw new RangeError(); offset = offset !== offset ? 0 : offset - offset % 1;
  if (offset < 0 || offset + 8 > bytes.length) throw new RangeError(); return offset;
}
function localBigSet(bytes: number[], offset: number, value: bigint, little = false): void {
  offset = localIndex(bytes, offset); const modulus = 0x10000000000000000n; value = (value % modulus + modulus) % modulus;
  for (let i = 0; i < 8; i++) { bytes[offset + (little ? i : 7 - i)] = Number(value % 256n); value /= 256n; }
}
function localSetBigUint64(bytes: number[], offset: number, value: bigint, little = false): void { localBigSet(bytes, offset, value, little); }
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
// A failed BigUint64 write leaves every byte unchanged in both byte orders and a valid final-word write preserves the leading bytes. Route: a discriminated union selecting the writer byte order. Node prints bigints-uint64-union-failed-write-atomic:ok.
type View = number[];
type WriteJob = { kind: "big"; view: View } | { kind: "little"; view: View };
function write(job: WriteJob, offset: number, value: bigint): void {
  if (job.kind === "big") localSetBigUint64(job.view, offset, value, false); else localSetBigUint64(job.view, offset, value, true);
}
const seed: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
for (const little of [false, true]) {
  const view: View = localDataView(localArrayBuffer(12)), job: WriteJob = little ? { kind: "little", view } : { kind: "big", view };
  for (let i = 0; i < 12; i++) localSetUint8(view, i, seed[i]);
  for (const offset of [-1, 5, 12]) {
    assert.throws(RangeError, () => write(job, offset, 0x89abcdef01234567n));
    const bytes: number[] = []; for (let i = 0; i < 12; i++) bytes[i] = localGetUint8(view, i); assert.compareArray(bytes, seed);
  }
  write(job, 4, 0x89abcdef01234567n);
  const finalBytes: number[] = []; for (let j = 0; j < 12; j++) finalBytes[j] = localGetUint8(view, j);
  assert.compareArray(finalBytes, little ? [1, 2, 3, 4, 103, 69, 35, 1, 239, 205, 171, 137] : [1, 2, 3, 4, 137, 171, 205, 239, 1, 35, 69, 103]);
}
console.log("bigints-uint64-union-failed-write-atomic:ok");
