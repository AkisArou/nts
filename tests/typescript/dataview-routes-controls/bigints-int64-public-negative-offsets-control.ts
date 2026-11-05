/*---
description: "Negative BigInt64 offsets throw RangeError for reads and writes without changing any byte, and valid access still succeeds. (control)"
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-class, ts-class-fields, ts-readonly, ts-errors, ts-arrow-functions]
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
function localGetBigInt64(bytes: number[], offset: number, little = false): bigint { return localBigGet(bytes, offset, true, little); }
function localSetBigInt64(bytes: number[], offset: number, value: bigint, little = false): void { localBigSet(bytes, offset, value, little); }
function localGetUint8(bytes: number[], offset: number): number { return bytes[offset]; }
// Negative BigInt64 offsets throw RangeError for reads and writes without changing any byte, and valid access still succeeds. Route: a public View field. Node prints bigints-int64-public-negative-offsets:ok.
type View = number[];
class WideSlot { view: View = localDataView(localArrayBuffer(8)); }
const slot = new WideSlot(), seed: readonly number[] = [1, 35, 69, 103, 137, 171, 205, 239];
for (let i = 0; i < 8; i++) localSetUint8(slot.view, i, seed[i]);
const offsets: readonly number[] = [-1, -1.9, -8, -Infinity];
for (const offset of offsets) {
  assert.throws(RangeError, () => localGetBigInt64(slot.view, offset));
  assert.throws(RangeError, () => localSetBigInt64(slot.view, offset, -0x1234n));
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = localGetUint8(slot.view, i);
  assert.compareArray(bytes, seed); assert.sameValue(localGetBigInt64(slot.view, 0), 0x0123456789abcdefn);
}
localSetBigInt64(slot.view, 0, -2n);
const finalBytes: number[] = []; for (let j = 0; j < 8; j++) finalBytes[j] = localGetUint8(slot.view, j);
assert.compareArray(finalBytes, [255, 255, 255, 255, 255, 255, 255, 254]);
console.log("bigints-int64-public-negative-offsets:ok");
