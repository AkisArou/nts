/*---
description: Aligned Int32 windows retain their buffer and exact offset and element count.
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-class, ts-class-fields, ts-readonly, ts-tuples]
---*/
// Aligned Int32 windows retain their buffer and exact offset and element count. Route: public window field.
// Node prints construction-layout-window-public-int32:ok after exact observations.
type BufferStorage = ArrayBuffer;
type Samples = Int32Array;
class WindowStore {
  data: Samples;
  constructor(buffer: BufferStorage, offset: number, size: number) { this.data = new Int32Array(buffer, offset, size); }
}
const rows: readonly [number, number, readonly number[]][] = [[0, 0, []], [0, 4, [0, 0, 0, 0]], [4, 2, [0, 0]], [12, 1, [0]], [16, 0, []]];
for (const [offset, size, expected] of rows) {
  const buffer: BufferStorage = new ArrayBuffer(16), data = new WindowStore(buffer, offset, size).data;
  const observed: number[] = [];
  assert.sameValue(data.buffer, buffer);
  assert.sameValue(data.byteOffset, offset);
  assert.sameValue(data.length, size);
  assert.sameValue(data.byteLength, size * 4);
  for (let i = 0; i < data.length; i++) observed[i] = data[i];
  assert.compareArray(observed, expected);
}
console.log("construction-layout-window-public-int32:ok");
