/*---
description: "Slicing an empty buffer makes a fresh fixed empty buffer that stays empty when the source grows through two interface implementations for empty sources."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-interfaces, ts-readonly, ts-tuples, ts-errors, ts-arrow-functions]
---*/

// Slicing an empty buffer makes a fresh fixed empty buffer that stays empty when the source grows; route: two interface implementations for empty sources.
// Node prints buffers-slice-empty-interface:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
interface EmptyStore { buffer: BufferStorage; copy(): BufferStorage; }
class FixedEmpty implements EmptyStore { buffer: BufferStorage = new ArrayBuffer(0); copy(): BufferStorage { return this.buffer.slice(); } }
class GrowingEmpty implements EmptyStore { buffer: BufferStorage = new ArrayBuffer(0, { maxByteLength: 8 }); copy(): BufferStorage { return this.buffer.slice(); } }
const stores: readonly [EmptyStore, boolean][] = [[new FixedEmpty(), false], [new GrowingEmpty(), true]];
for (const [store, grows] of stores) {
  const copy = store.copy(), view: View = new DataView(copy);
  assert.sameValue(copy === store.buffer, false); assert.sameValue(copy.resizable, false); assert.sameValue(copy.maxByteLength, 0);
  assert.sameValue(copy.detached, false); assert.sameValue(store.buffer.detached, false);
  if (grows) store.buffer.resize(4);
  assert.sameValue(view.byteLength, 0); assert.sameValue(view.buffer === copy, true);
  assert.throws(RangeError, () => view.getUint8(0));
}
console.log("buffers-slice-empty-interface:ok");
