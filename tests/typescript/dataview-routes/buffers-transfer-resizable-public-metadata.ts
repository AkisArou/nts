/*---
description: "A transferred resizable buffer retains its maximum and can grow again without losing retained bytes through a public resizable buffer field."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-readonly, ts-tuples, ts-unions, ts-null-undefined]
---*/

// A transferred resizable buffer retains its maximum and can grow again without losing retained bytes; route: a public resizable buffer field.
// Node prints buffers-transfer-resizable-public-metadata:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
class MovableStore { buffer: BufferStorage = new ArrayBuffer(4, { maxByteLength: 12 }); }
const rows: readonly [number | undefined, readonly number[]][] = [
  [undefined, [11, 22, 33, 44, 0, 0, 0, 0, 0, 0, 0, 0]], [2, [11, 22, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]], [8, [11, 22, 33, 44, 0, 0, 0, 0, 0, 0, 0, 0]]
];
for (const [length, expected] of rows) {
  const store = new MovableStore(), before: View = new DataView(store.buffer);
  for (let i = 0; i < 4; i++) before.setUint8(i, 11 * (i + 1));
  const moved = store.buffer.transfer(length), view: View = new DataView(moved);
  assert.sameValue(store.buffer.detached, true); assert.sameValue(moved.resizable, true); assert.sameValue(moved.maxByteLength, 12);
  assert.sameValue(view.byteLength, length === undefined ? 4 : length);
  moved.resize(12); assert.sameValue(view.byteLength, 12);
  const bytes: number[] = []; for (let i = 0; i < 12; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expected);
}
console.log("buffers-transfer-resizable-public-metadata:ok");
