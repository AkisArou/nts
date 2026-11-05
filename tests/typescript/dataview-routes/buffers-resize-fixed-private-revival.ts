/*---
description: "A fixed view becomes unreadable when out of bounds and revives with zeroed truncated bytes through a private fixed view."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-private-fields, ts-errors, ts-arrow-functions, ts-readonly, ts-tuples]
---*/

// A fixed view becomes unreadable when out of bounds and revives with zeroed truncated bytes; route: a private fixed view.
// Node prints buffers-resize-fixed-private-revival:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
class FixedStore {
  buffer: BufferStorage = new ArrayBuffer(4, { maxByteLength: 8 });
  #view: View = new DataView(this.buffer, 0, 4);
  read(): View { return this.#view; }
}
const store = new FixedStore(), view = store.read();
for (let i = 0; i < 4; i++) view.setUint8(i, i + 1);
const rows: readonly [number, readonly number[]][] = [[2, [1, 2, 0, 0]], [0, [0, 0, 0, 0]]];
for (const [size, expected] of rows) {
  store.buffer.resize(size);
  assert.throws(TypeError, () => view.byteLength); assert.throws(TypeError, () => view.getUint8(0));
  store.buffer.resize(4); assert.sameValue(view.byteLength, 4);
  const bytes: number[] = []; for (let i = 0; i < 4; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expected);
}
console.log("buffers-resize-fixed-private-revival:ok");
