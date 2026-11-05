/*---
description: "Int16 accesses the final fitting word of its private window and failed accesses leave the complete backing bytes unchanged."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-errors, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring, ts-class, ts-class-fields, ts-private-fields, ts-this]
---*/

// Int16 accesses the final fitting word of its private window and failed accesses leave the complete backing bytes unchanged. Route: a private fixed-window field. Node prints views-access-int16-private-window-bounds:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
function readBytes(view: View): number[] { const bytes: number[] = []; for (let i = 0; i < view.byteLength; i++) bytes[i] = view.getUint8(i); return bytes; }
class AccessBox {
  #view: View; constructor(view: View) { this.#view = view; }
  read(offset: number): number { return this.#view.getInt16(offset, false); }
  write(offset: number, value: number): void { this.#view.setInt16(offset, value, false); }
}
const rows: readonly [number, readonly number[]][] = [
  [-2, [90, 90, 90, 90, 90, 255, 254, 90, 90, 90, 90, 90]], [4660, [90, 90, 90, 90, 90, 18, 52, 90, 90, 90, 90, 90]]
];
for (const [value, expected] of rows) {
  const buffer: BufferStorage = new ArrayBuffer(12), whole: View = new DataView(buffer), slot = new AccessBox(new DataView(buffer, 3, 4));
  for (let i = 0; i < 12; i++) whole.setUint8(i, 90);
  slot.write(2, value); assert.sameValue(slot.read(2), value); assert.compareArray(readBytes(whole), expected);
  for (const offset of [-1, -1.9, 3, 4]) {
    assert.throws(RangeError, () => slot.read(offset)); assert.throws(RangeError, () => slot.write(offset, value));
    assert.compareArray(readBytes(whole), expected);
  }
}
console.log("views-access-int16-private-window-bounds:ok");
