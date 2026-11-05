/*---
description: "Transfer beyond a resizable maximum throws without detaching or changing the source through guarded Map entries carrying resizable buffers."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-map-set, ts-strings, ts-errors, ts-arrow-functions]
---*/

// Transfer beyond a resizable maximum throws without detaching or changing the source; route: guarded Map entries carrying resizable buffers.
// Node prints buffers-transfer-resizable-max-map:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
const stores: Map<string, BufferStorage> = new Map([["small", new ArrayBuffer(2, { maxByteLength: 4 })], ["large", new ArrayBuffer(3, { maxByteLength: 8 })]]);
for (const key of ["small", "large"]) {
  const buffer = stores.get(key); if (buffer === undefined) throw new Error("missing buffer");
  const view: View = new DataView(buffer), length = buffer.byteLength, maximum = buffer.maxByteLength, expected: number[] = [];
  for (let i = 0; i < length; i++) { expected[i] = 17 + i; view.setUint8(i, expected[i]); }
  assert.throws(RangeError, () => buffer.transfer(maximum + 1));
  assert.sameValue(buffer.detached, false); assert.sameValue(buffer.byteLength, length);
  const bytes: number[] = []; for (let i = 0; i < length; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expected);
  const moved = buffer.transfer(maximum); assert.sameValue(moved.byteLength, maximum); assert.sameValue(buffer.detached, true);
}
console.log("buffers-transfer-resizable-max-map:ok");
