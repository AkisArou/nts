/*---
description: "TransferToFixedLength produces a fixed destination from either kind of source through two implementations of a movable store interface."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-interfaces, ts-readonly, ts-errors, ts-arrow-functions]
---*/

// TransferToFixedLength produces a fixed destination from either kind of source; route: two implementations of a movable store interface.
// Node prints buffers-transfer-fixed-interface:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
interface Movable { buffer: BufferStorage; move(size: number): BufferStorage; }
class PlainStore implements Movable {
  buffer: BufferStorage = new ArrayBuffer(2); move(size: number): BufferStorage { return this.buffer.transferToFixedLength(size); }
}
class GrowingStore implements Movable {
  buffer: BufferStorage = new ArrayBuffer(2, { maxByteLength: 8 }); move(size: number): BufferStorage { return this.buffer.transferToFixedLength(size); }
}
const stores: readonly Movable[] = [new PlainStore(), new GrowingStore()];
for (const store of stores) {
  const before: View = new DataView(store.buffer); before.setUint8(0, 9); before.setUint8(1, 5);
  const moved = store.move(4), view: View = new DataView(moved);
  assert.sameValue(store.buffer.detached, true); assert.sameValue(moved.resizable, false); assert.sameValue(moved.maxByteLength, 4);
  assert.throws(TypeError, () => moved.resize(5));
  const bytes: number[] = []; for (let i = 0; i < view.byteLength; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, [9, 5, 0, 0]);
}
console.log("buffers-transfer-fixed-interface:ok");
