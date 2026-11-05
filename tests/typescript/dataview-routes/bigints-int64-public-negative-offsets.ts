/*---
description: "Negative BigInt64 offsets throw RangeError for reads and writes without changing any byte, and valid access still succeeds."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-class, ts-class-fields, ts-readonly, ts-errors, ts-arrow-functions]
---*/

// Negative BigInt64 offsets throw RangeError for reads and writes without changing any byte, and valid access still succeeds. Route: a public View field. Node prints bigints-int64-public-negative-offsets:ok.
type View = DataView;
class WideSlot { view: View = new DataView(new ArrayBuffer(8)); }
const slot = new WideSlot(), seed: readonly number[] = [1, 35, 69, 103, 137, 171, 205, 239];
for (let i = 0; i < 8; i++) slot.view.setUint8(i, seed[i]);
const offsets: readonly number[] = [-1, -1.9, -8, -Infinity];
for (const offset of offsets) {
  assert.throws(RangeError, () => slot.view.getBigInt64(offset));
  assert.throws(RangeError, () => slot.view.setBigInt64(offset, -0x1234n));
  const bytes: number[] = []; for (let i = 0; i < 8; i++) bytes[i] = slot.view.getUint8(i);
  assert.compareArray(bytes, seed); assert.sameValue(slot.view.getBigInt64(0), 0x0123456789abcdefn);
}
slot.view.setBigInt64(0, -2n);
const finalBytes: number[] = []; for (let j = 0; j < 8; j++) finalBytes[j] = slot.view.getUint8(j);
assert.compareArray(finalBytes, [255, 255, 255, 255, 255, 255, 255, 254]);
console.log("bigints-int64-public-negative-offsets:ok");
