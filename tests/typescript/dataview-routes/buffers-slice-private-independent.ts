/*---
description: "Slice creates independent bytes in both mutation directions through a private buffer exposed through a copy method."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples]
---*/

// Slice creates independent bytes in both mutation directions; route: a private buffer exposed through a copy method.
// Node prints buffers-slice-private-independent:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
class CopyStore {
  #buffer: BufferStorage = new ArrayBuffer(6); view: View = new DataView(this.#buffer);
  copy(start: number, end: number): BufferStorage { return this.#buffer.slice(start, end); }
}
function readBytes(view: View): number[] { const bytes: number[] = []; for (let i = 0; i < view.byteLength; i++) bytes[i] = view.getUint8(i); return bytes; }
const rows: readonly [number, number, readonly number[]][] = [[1, 4, [20, 30, 40]], [0, 6, [10, 20, 30, 40, 50, 60]], [2, 2, []]];
for (const [start, end, expected] of rows) {
  const store = new CopyStore(); for (let i = 0; i < 6; i++) store.view.setUint8(i, 10 * (i + 1));
  const copy = store.copy(start, end), view: View = new DataView(copy);
  assert.sameValue(copy === store.view.buffer, false); assert.compareArray(readBytes(view), expected);
  store.view.setUint8(start, 99); assert.compareArray(readBytes(view), expected);
  if (expected.length > 0) { view.setUint8(0, 77); assert.sameValue(store.view.getUint8(start), 99); assert.sameValue(view.getUint8(0), 77); }
}
console.log("buffers-slice-private-independent:ok");
