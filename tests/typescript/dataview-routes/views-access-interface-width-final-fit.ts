/*---
description: "Each implementation accepts its own final fitting position and rejects a wider access before any backing byte changes."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-errors, ts-arrow-functions, ts-readonly, ts-tuples, ts-destructuring, ts-interfaces, ts-class]
---*/

// Each implementation accepts its own final fitting position and rejects a wider access before any backing byte changes. Route: an interface with two-byte and four-byte accessor implementations. Node prints views-access-interface-width-final-fit:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
function readBytes(view: View): number[] { const bytes: number[] = []; for (let i = 0; i < view.byteLength; i++) bytes[i] = view.getUint8(i); return bytes; }
interface WindowAccess { read(view: View, offset: number): number; write(view: View, offset: number, value: number): void; }
class ShortAccess implements WindowAccess { read(view: View, offset: number): number { return view.getUint16(offset, false); } write(view: View, offset: number, value: number): void { view.setUint16(offset, value, false); } }
class WordAccess implements WindowAccess { read(view: View, offset: number): number { return view.getUint32(offset, false); } write(view: View, offset: number, value: number): void { view.setUint32(offset, value, false); } }
const rows: readonly [WindowAccess, number, number, readonly number[]][] = [
  [new ShortAccess(), 2, 0x1234, [90, 90, 90, 90, 90, 90, 18, 52, 90, 90]], [new ShortAccess(), 2, 0x8001, [90, 90, 90, 90, 90, 90, 128, 1, 90, 90]],
  [new WordAccess(), 4, 305419896, [90, 90, 90, 90, 18, 52, 86, 120, 90, 90]], [new WordAccess(), 4, 2147483649, [90, 90, 90, 90, 128, 0, 0, 1, 90, 90]]
];
for (const [route, width, value, expected] of rows) {
  const buffer: BufferStorage = new ArrayBuffer(10), whole: View = new DataView(buffer), view: View = new DataView(buffer, 2, 6), last = 6 - width;
  for (let i = 0; i < 10; i++) whole.setUint8(i, 90);
  route.write(view, last, value); assert.sameValue(route.read(view, last), value); assert.compareArray(readBytes(whole), expected);
  for (const offset of [-1, last + 1]) {
    assert.throws(RangeError, () => route.read(view, offset)); assert.throws(RangeError, () => route.write(view, offset, value));
    assert.compareArray(readBytes(whole), expected);
  }
}
console.log("views-access-interface-width-final-fit:ok");
