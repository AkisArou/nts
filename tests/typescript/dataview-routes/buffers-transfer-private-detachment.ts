/*---
description: "Transfer detaches every old view while keeping its buffer identity and all moved bytes through a private buffer moved through a class method."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-errors, ts-arrow-functions]
---*/

// Transfer detaches every old view while keeping its buffer identity and all moved bytes; route: a private buffer moved through a class method.
// Node prints buffers-transfer-private-detachment:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
class MoveStore {
  #buffer: BufferStorage; constructor(buffer: BufferStorage) { this.#buffer = buffer; }
  move(): BufferStorage { return this.#buffer.transfer(); }
}
const samples: readonly (readonly number[])[] = [[], [7], [1, 2, 3, 4]];
for (const sample of samples) {
  const buffer: BufferStorage = new ArrayBuffer(sample.length), old: View = new DataView(buffer), store = new MoveStore(buffer);
  for (let i = 0; i < sample.length; i++) old.setUint8(i, sample[i]);
  const moved = store.move(), view: View = new DataView(moved);
  assert.sameValue(buffer.byteLength, 0); assert.sameValue(buffer.detached, true); assert.sameValue(old.buffer === buffer, true);
  assert.throws(TypeError, () => old.getUint8(0)); assert.throws(TypeError, () => old.byteLength);
  assert.throws(TypeError, () => old.byteOffset); assert.throws(TypeError, () => new DataView(buffer));
  const bytes: number[] = []; for (let i = 0; i < view.byteLength; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, sample); assert.sameValue(moved === buffer, false);
}
console.log("buffers-transfer-private-detachment:ok");
