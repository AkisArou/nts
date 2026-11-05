/*---
description: "Float64 accepts exactly the final fitting eight-byte word and failed writes preserve every byte of the larger backing buffer."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-errors, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring, ts-class, ts-class-fields, ts-this]
---*/

// Float64 accepts exactly the final fitting eight-byte word and failed writes preserve every byte of the larger backing buffer. Route: a public fixed-window field. Node prints views-access-float64-public-window-bounds:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
function readBytes(view: View): number[] { const bytes: number[] = []; for (let i = 0; i < view.byteLength; i++) bytes[i] = view.getUint8(i); return bytes; }
class AccessBox { view: View; constructor(view: View) { this.view = view; } }
const rows: readonly [number, readonly number[]][] = [
  [1.5, [90, 90, 90, 90, 90, 63, 248, 0, 0, 0, 0, 0, 0, 90, 90, 90, 90, 90]],
  [-2.5, [90, 90, 90, 90, 90, 192, 4, 0, 0, 0, 0, 0, 0, 90, 90, 90, 90, 90]]
];
for (const [value, expected] of rows) {
  const buffer: BufferStorage = new ArrayBuffer(18), whole: View = new DataView(buffer), slot = new AccessBox(new DataView(buffer, 3, 10));
  for (let i = 0; i < 18; i++) whole.setUint8(i, 90);
  slot.view.setFloat64(2, value, false); assert.sameValue(slot.view.getFloat64(2, false), value); assert.compareArray(readBytes(whole), expected);
  for (const offset of [-1, 3, 10]) {
    assert.throws(RangeError, () => slot.view.getFloat64(offset, false));
    assert.throws(RangeError, () => slot.view.setFloat64(offset, value, false)); assert.compareArray(readBytes(whole), expected);
  }
}
console.log("views-access-float64-public-window-bounds:ok");
