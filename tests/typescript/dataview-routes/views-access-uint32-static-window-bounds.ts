/*---
description: "Uint32 uses the final four bytes of its own window and rejects accesses that fit only the larger backing buffer."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-errors, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring, ts-class, ts-class-fields, ts-static]
---*/

// Uint32 uses the final four bytes of its own window and rejects accesses that fit only the larger backing buffer. Route: a static fixed-window field. Node prints views-access-uint32-static-window-bounds:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
function readBytes(view: View): number[] { const bytes: number[] = []; for (let i = 0; i < view.byteLength; i++) bytes[i] = view.getUint8(i); return bytes; }
const buffer: BufferStorage = new ArrayBuffer(14), whole: View = new DataView(buffer);
class AccessSlot { static view: View = new DataView(buffer, 2, 6); }
const rows: readonly [number, readonly number[]][] = [
  [305419896, [90, 90, 90, 90, 120, 86, 52, 18, 90, 90, 90, 90, 90, 90]],
  [2147483649, [90, 90, 90, 90, 1, 0, 0, 128, 90, 90, 90, 90, 90, 90]]
];
for (const [value, expected] of rows) {
  for (let i = 0; i < 14; i++) whole.setUint8(i, 90);
  AccessSlot.view.setUint32(2, value, true); assert.sameValue(AccessSlot.view.getUint32(2, true), value); assert.compareArray(readBytes(whole), expected);
  for (const offset of [-1, -1.9, 3, 6]) {
    assert.throws(RangeError, () => AccessSlot.view.getUint32(offset, true));
    assert.throws(RangeError, () => AccessSlot.view.setUint32(offset, value, true)); assert.compareArray(readBytes(whole), expected);
  }
}
console.log("views-access-uint32-static-window-bounds:ok");
