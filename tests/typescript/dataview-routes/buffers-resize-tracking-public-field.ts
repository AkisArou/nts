/*---
description: "A tracking view follows growth and shrinkage and newly grown bytes are zero through a public buffer and view field."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-readonly, ts-tuples]
---*/

// A tracking view follows growth and shrinkage and newly grown bytes are zero; route: a public buffer and view field.
// Node prints buffers-resize-tracking-public-field:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
class TrackingStore {
  buffer: BufferStorage = new ArrayBuffer(4, { maxByteLength: 8 });
  view: View = new DataView(this.buffer);
}
const store = new TrackingStore();
for (let i = 0; i < 4; i++) store.view.setUint8(i, 11 * (i + 1));
const rows: readonly [number, readonly number[]][] = [[8, [11, 22, 33, 44, 0, 0, 0, 0]], [2, [11, 22]], [6, [11, 22, 0, 0, 0, 0]], [0, []], [3, [0, 0, 0]]];
for (const [size, expected] of rows) {
  store.buffer.resize(size);
  assert.sameValue(store.view.byteLength, size);
  const bytes: number[] = []; for (let i = 0; i < size; i++) bytes[i] = store.view.getUint8(i);
  assert.compareArray(bytes, expected);
}
console.log("buffers-resize-tracking-public-field:ok");
