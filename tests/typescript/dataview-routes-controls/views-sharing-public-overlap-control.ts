/*---
description: "Overlapping DataViews observe writes from either sibling at the shared byte and preserve every other byte through public fields holding two offset views and their whole-buffer view."
features: [ts-dataview-routes, ts-dataview-route-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-this]
---*/

type LocalView = { buffer: number[]; byteOffset: number; byteLength: number };
function localArrayBuffer(size: number): number[] { const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = 0; return bytes; }
function localDataView(buffer: number[], byteOffset = 0, byteLength = buffer.length - byteOffset): LocalView { return { buffer, byteOffset, byteLength }; }
function localGetUint8(view: LocalView, offset: number): number { return view.buffer[view.byteOffset + offset]; }
function localSetUint8(view: LocalView, offset: number, value: number): void { view.buffer[view.byteOffset + offset] = value; }

// Overlapping DataViews observe writes from either sibling at the shared byte and preserve every other byte; route: public fields holding two offset views and their whole-buffer view.
// Node prints views-sharing-public-overlap:ok.
type BufferStorage = number[];
type View = LocalView;
class SharingPair {
  buffer: BufferStorage = localArrayBuffer(8);
  whole: View = localDataView(this.buffer);
  left: View = localDataView(this.buffer, 1, 4);
  right: View = localDataView(this.buffer, 3, 4);
}
for (const value of [1, 128, 255]) {
  const pair = new SharingPair(); localSetUint8(pair.left, 2, value);
  assert.sameValue(localGetUint8(pair.right, 0), value);
  localSetUint8(pair.right, 1, 17); assert.sameValue(localGetUint8(pair.left, 3), 17);
  assert.sameValue(pair.left.buffer === pair.right.buffer, true); assert.sameValue(pair.whole.buffer === pair.buffer, true);
  const observed: number[] = []; for (let i = 0; i < 8; i++) observed[i] = localGetUint8(pair.whole, i);
  assert.compareArray(observed, [0, 0, 0, value, 17, 0, 0, 0]);
}
console.log("views-sharing-public-overlap:ok");
