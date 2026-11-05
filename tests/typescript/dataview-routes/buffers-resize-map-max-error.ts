/*---
description: "A resize beyond the maximum throws without changing the existing bytes or length through guarded Map lookups of buffers."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-map-set, ts-strings, ts-errors, ts-arrow-functions]
---*/

// A resize beyond the maximum throws without changing the existing bytes or length; route: guarded Map lookups of buffers.
// Node prints buffers-resize-map-max-error:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
const stores: Map<string, BufferStorage> = new Map([
  ["small", new ArrayBuffer(2, { maxByteLength: 4 })], ["large", new ArrayBuffer(3, { maxByteLength: 8 })]
]);
for (const key of ["small", "large"]) {
  const buffer = stores.get(key); if (buffer === undefined) throw new Error("missing buffer");
  const view: View = new DataView(buffer), length = buffer.byteLength, maximum = buffer.maxByteLength;
  view.setUint8(0, 17);
  assert.throws(RangeError, () => buffer.resize(maximum + 1));
  assert.sameValue(buffer.byteLength, length); assert.sameValue(view.getUint8(0), 17); assert.sameValue(buffer.detached, false);
  buffer.resize(maximum); assert.sameValue(view.byteLength, maximum);
  const bytes: number[] = []; for (let i = 1; i < maximum; i++) bytes[i - 1] = view.getUint8(i);
  for (const byte of bytes) assert.sameValue(byte, 0);
}
console.log("buffers-resize-map-max-error:ok");
