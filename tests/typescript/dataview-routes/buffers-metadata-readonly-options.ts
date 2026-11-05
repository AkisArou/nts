/*---
description: "Plain and resizable buffers expose their exact initial length maximum and resize flag through readonly tuples of constructor options."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-readonly, ts-tuples, ts-unions, ts-null-undefined]
---*/

// Plain and resizable buffers expose their exact initial length maximum and resize flag; route: readonly tuples of constructor options.
// Node prints buffers-metadata-readonly-options:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
const rows: readonly [number, number | undefined, boolean, number][] = [[0, undefined, false, 0], [4, undefined, false, 4], [0, 8, true, 8], [4, 16, true, 16], [4, 4, true, 4]];
for (const [length, maximum, growable, expectedMaximum] of rows) {
  const buffer: BufferStorage = new ArrayBuffer(length, maximum === undefined ? undefined : { maxByteLength: maximum });
  const view: View = new DataView(buffer);
  assert.sameValue(buffer.byteLength, length); assert.sameValue(buffer.maxByteLength, expectedMaximum);
  assert.sameValue(buffer.resizable, growable); assert.sameValue(buffer.detached, false);
  assert.sameValue(view.byteLength, length); assert.sameValue(view.buffer === buffer, true);
}
console.log("buffers-metadata-readonly-options:ok");
