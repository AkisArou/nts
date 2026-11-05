/*---
description: "BigUint64 rejects offsets beyond the last fitting word without partial writes and accepts the final valid little-endian read."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-class, ts-class-fields, ts-static, ts-readonly, ts-errors, ts-arrow-functions]
---*/

// BigUint64 rejects offsets beyond the last fitting word without partial writes and accepts the final valid little-endian read. Route: a static View field. Node prints bigints-uint64-static-nonfitting-offsets:ok.
type View = DataView;
class WideSlot { static view: View = new DataView(new ArrayBuffer(12)); }
const seed: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
for (let i = 0; i < 12; i++) WideSlot.view.setUint8(i, seed[i]);
const offsets: readonly number[] = [5, 5.9, 8, 12, Infinity];
for (const offset of offsets) {
  assert.throws(RangeError, () => WideSlot.view.getBigUint64(offset, true));
  assert.throws(RangeError, () => WideSlot.view.setBigUint64(offset, 0x8000000000000001n, true));
  const bytes: number[] = []; for (let i = 0; i < 12; i++) bytes[i] = WideSlot.view.getUint8(i);
  assert.compareArray(bytes, seed); assert.sameValue(WideSlot.view.getBigUint64(4, true), 0x0c0b0a0908070605n);
}
console.log("bigints-uint64-static-nonfitting-offsets:ok");
