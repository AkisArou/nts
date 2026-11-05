/*---
description: "BigUint64 rejects offsets beyond the last fitting word without partial writes and accepts the final valid little-endian read. (control)"
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-class, ts-class-fields, ts-static, ts-readonly, ts-errors, ts-arrow-functions]
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
function localBigSet(bytes: number[], offset: number, value: bigint, little = false): void {
  offset = localIndex(bytes, offset); const modulus = 0x10000000000000000n; value = (value % modulus + modulus) % modulus;
  for (let i = 0; i < 8; i++) { bytes[offset + (little ? i : 7 - i)] = Number(value % 256n); value /= 256n; }
}
function localSetUint8(bytes: number[], offset: number, value: number): void { bytes[offset] = value; }
function localGetBigUint64(bytes: number[], offset: number, little = false): bigint { return localBigGet(bytes, offset, false, little); }
function localSetBigUint64(bytes: number[], offset: number, value: bigint, little = false): void { localBigSet(bytes, offset, value, little); }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
// BigUint64 rejects offsets beyond the last fitting word without partial writes and accepts the final valid little-endian read. Route: a static View field. Node prints bigints-uint64-static-nonfitting-offsets:ok.
type View = number[];
class WideSlot { static view: View = localDataView(localArrayBuffer(12)); }
const seed: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
for (let i = 0; i < 12; i++) localSetUint8(WideSlot.view, i, seed[i]);
const offsets: readonly number[] = [5, 5.9, 8, 12, Infinity];
for (const offset of offsets) {
  assert.throws(RangeError, () => localGetBigUint64(WideSlot.view, offset, true));
  assert.throws(RangeError, () => localSetBigUint64(WideSlot.view, offset, 0x8000000000000001n, true));
  const bytes: number[] = []; for (let i = 0; i < 12; i++) bytes[i] = localGetUint8(WideSlot.view, i);
  assert.compareArray(bytes, seed); assert.sameValue(localGetBigUint64(WideSlot.view, 4, true), 0x0c0b0a0908070605n);
}
console.log("bigints-uint64-static-nonfitting-offsets:ok");
