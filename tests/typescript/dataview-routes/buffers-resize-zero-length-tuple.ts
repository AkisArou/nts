/*---
description: "An explicit zero-length view stays empty while an omitted length tracks growth through a readonly tuple carrying fixed and tracking views."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-readonly, ts-tuples, ts-errors, ts-arrow-functions]
---*/

// An explicit zero-length view stays empty while an omitted length tracks growth; route: a readonly tuple carrying fixed and tracking views.
// Node prints buffers-resize-zero-length-tuple:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
const buffer: BufferStorage = new ArrayBuffer(0, { maxByteLength: 8 });
const tracking: View = new DataView(buffer), fixed: View = new DataView(buffer, 0, 0);
const rows: readonly [View, boolean][] = [[tracking, true], [fixed, false]];
for (const size of [4, 0, 8]) {
  buffer.resize(size);
  for (const [view, follows] of rows) {
    assert.sameValue(view.byteLength, follows ? size : 0);
    assert.sameValue(view.byteOffset, 0); assert.sameValue(view.buffer === buffer, true);
    if (!follows || size === 0) assert.throws(RangeError, () => view.getUint8(0));
    else assert.sameValue(view.getUint8(0), 0);
  }
}
console.log("buffers-resize-zero-length-tuple:ok");
