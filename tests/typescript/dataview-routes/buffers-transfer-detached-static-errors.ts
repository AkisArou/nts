/*---
description: "A detached buffer rejects both subsequent transfer operations through a reassigned static buffer field."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-static, ts-errors, ts-arrow-functions]
---*/

// A detached buffer rejects both subsequent transfer operations; route: a reassigned static buffer field.
// Node prints buffers-transfer-detached-static-errors:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
class TransferSlot { static buffer: BufferStorage = new ArrayBuffer(0); }
for (const size of [0, 1, 4]) {
  TransferSlot.buffer = new ArrayBuffer(size, { maxByteLength: 8 });
  const before: View = new DataView(TransferSlot.buffer);
  for (let i = 0; i < size; i++) before.setUint8(i, 31 + i);
  const moved = TransferSlot.buffer.transfer(), view: View = new DataView(moved);
  assert.throws(TypeError, () => TransferSlot.buffer.transfer());
  assert.throws(TypeError, () => TransferSlot.buffer.transferToFixedLength());
  assert.sameValue(TransferSlot.buffer.detached, true); assert.sameValue(TransferSlot.buffer.byteLength, 0);
  assert.sameValue(view.byteLength, size);
  for (let i = 0; i < size; i++) assert.sameValue(view.getUint8(i), 31 + i);
}
console.log("buffers-transfer-detached-static-errors:ok");
