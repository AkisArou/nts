/*---
description: "Captured accessors use the current window and offset for successful final-fitting writes and preserve the backing bytes after failures."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-errors, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring, ts-closures]
---*/

// Captured accessors use the current window and offset for successful final-fitting writes and preserve the backing bytes after failures. Route: reassigned View, offset and value lets captured by typed closures. Node prints views-access-captured-window-replacement:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
function readBytes(view: View): number[] { const bytes: number[] = []; for (let i = 0; i < view.byteLength; i++) bytes[i] = view.getUint8(i); return bytes; }
const buffer: BufferStorage = new ArrayBuffer(12), whole: View = new DataView(buffer);
let selected: View = new DataView(buffer, 0, 2); let position = 0, value = 0;
const read: () => number = () => selected.getInt16(position, true);
const write: () => void = () => { selected.setInt16(position, value, true); };
const rows: readonly [number, number, number, number, readonly number[]][] = [
  [1, 4, 2, -2, [90, 90, 90, 254, 255, 90, 90, 90, 90, 90, 90, 90]],
  [6, 2, 0, 4660, [90, 90, 90, 90, 90, 90, 52, 18, 90, 90, 90, 90]]
];
for (const [windowOffset, length, last, next, expected] of rows) {
  selected = new DataView(buffer, windowOffset, length); position = last; value = next;
  for (let i = 0; i < 12; i++) whole.setUint8(i, 90);
  write(); assert.sameValue(read(), value); assert.compareArray(readBytes(whole), expected);
  for (const invalid of [-1, last + 1]) {
    position = invalid; assert.throws(RangeError, read); assert.throws(RangeError, write); assert.compareArray(readBytes(whole), expected);
  }
}
console.log("views-access-captured-window-replacement:ok");
