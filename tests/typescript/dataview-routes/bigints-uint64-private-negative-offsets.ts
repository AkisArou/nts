/*---
description: "Negative BigUint64 offsets throw RangeError without modifying the stored bytes, and a later valid little-endian write succeeds."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-readonly, ts-errors, ts-arrow-functions]
---*/

// Negative BigUint64 offsets throw RangeError without modifying the stored bytes, and a later valid little-endian write succeeds. Route: a private View field accessed through typed methods. Node prints bigints-uint64-private-negative-offsets:ok.
type View = DataView;
class WideSlot {
  #view: View = new DataView(new ArrayBuffer(8));
  constructor(seed: readonly number[]) { for (let i = 0; i < 8; i++) this.#view.setUint8(i, seed[i]); }
  read(offset: number): bigint { return this.#view.getBigUint64(offset, true); }
  write(offset: number, value: bigint): void { this.#view.setBigUint64(offset, value, true); }
  bytes(): number[] { const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = this.#view.getUint8(i); return bytes; }
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
