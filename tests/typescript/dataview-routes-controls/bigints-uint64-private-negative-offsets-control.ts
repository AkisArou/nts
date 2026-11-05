/*---
description: "Negative BigUint64 offsets throw RangeError without modifying the stored bytes, and a later valid little-endian write succeeds. (control)"
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-readonly, ts-errors, ts-arrow-functions]
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
// Negative BigUint64 offsets throw RangeError without modifying the stored bytes, and a later valid little-endian write succeeds. Route: a private View field accessed through typed methods. Node prints bigints-uint64-private-negative-offsets:ok.
type View = number[];
class WideSlot {
  #view: View = localDataView(localArrayBuffer(8));
  constructor(seed: readonly number[]) { for (let i = 0; i < 8; i++) localSetUint8(this.#view, i, seed[i]); }
  read(offset: number): bigint { return localGetBigUint64(this.#view, offset, true); }
  write(offset: number, value: bigint): void { localSetBigUint64(this.#view, offset, value, true); }
  bytes(): number[] { const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = localGetUint8(this.#view, i); return bytes; }
}
const seed: readonly number[] = [239, 205, 171, 137, 103, 69, 35, 1], slot = new WideSlot(seed);
const offsets: readonly number[] = [-1, -1.9, -8, -Infinity];
for (const offset of offsets) {
  assert.throws(RangeError, () => slot.read(offset)); assert.throws(RangeError, () => slot.write(offset, 0x8000000000000001n));
  assert.compareArray(slot.bytes(), seed); assert.sameValue(slot.read(0), 0x0123456789abcdefn);
}
slot.write(0, 0x8000000000000001n);
assert.sameValue(slot.read(0), 0x8000000000000001n); assert.compareArray(slot.bytes(), [1, 0, 0, 0, 0, 0, 0, 128]);
console.log("bigints-uint64-private-negative-offsets:ok");
