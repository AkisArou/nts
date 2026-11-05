/*---
description: Ragged buffers reject omitted Int32 lengths but accept an explicit empty window.
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-map-set, ts-readonly, ts-errors]
---*/
// Ragged buffers reject omitted Int32 lengths but accept an explicit empty window. Route: guarded buffer Map get.
// Node prints construction-layout-window-ragged-map:ok after exact observations.
type BufferStorage = ArrayBuffer;
const buffers = new Map<string, BufferStorage>([["one", new ArrayBuffer(1)], ["two", new ArrayBuffer(2)], ["six", new ArrayBuffer(6)], ["ten", new ArrayBuffer(10)]]);
const names: readonly string[] = ["one", "two", "six", "ten"];
for (const name of names) {
  const buffer = buffers.get(name);
  if (buffer === undefined) throw new Error("missing buffer");
  assert.throws(RangeError, () => new Int32Array(buffer));
  const data = new Int32Array(buffer, 0, 0), observed: number[] = [];
  assert.sameValue(data.buffer, buffer);
  assert.sameValue(data.byteOffset, 0);
  assert.sameValue(data.length, 0);
  assert.sameValue(data.byteLength, 0);
  for (let i = 0; i < data.length; i++) observed[i] = data[i];
  assert.compareArray(observed, []);
}
console.log("construction-layout-window-ragged-map:ok");
