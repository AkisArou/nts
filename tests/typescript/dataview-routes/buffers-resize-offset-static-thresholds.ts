/*---
description: "An offset tracking view distinguishes an empty valid window from an out-of-bounds window through static buffer and offset view fields."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-static, ts-readonly, ts-tuples, ts-errors, ts-arrow-functions]
---*/

// An offset tracking view distinguishes an empty valid window from an out-of-bounds window; route: static buffer and offset view fields.
// Node prints buffers-resize-offset-static-thresholds:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
class OffsetStore {
  static buffer: BufferStorage = new ArrayBuffer(4, { maxByteLength: 8 });
  static view: View = new DataView(OffsetStore.buffer, 2);
}
const rows: readonly [number, number][] = [[8, 6], [2, 0], [1, -1], [5, 3]];
for (const [size, length] of rows) {
  OffsetStore.buffer.resize(size);
  if (length < 0) {
    assert.throws(TypeError, () => OffsetStore.view.byteLength);
    assert.throws(TypeError, () => OffsetStore.view.byteOffset);
  } else {
    assert.sameValue(OffsetStore.view.byteLength, length); assert.sameValue(OffsetStore.view.byteOffset, 2);
    if (length === 0) assert.throws(RangeError, () => OffsetStore.view.getUint8(0));
    else assert.sameValue(OffsetStore.view.getUint8(0), 0);
  }
}
console.log("buffers-resize-offset-static-thresholds:ok");
