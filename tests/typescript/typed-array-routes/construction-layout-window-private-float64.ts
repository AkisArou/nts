/*---
description: Eight-byte Float64 windows preserve aligned offsets and an empty end window.
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-class, ts-class-fields, ts-private-fields, ts-readonly, ts-tuples]
---*/
// Eight-byte Float64 windows preserve aligned offsets and an empty end window. Route: private window field.
// Node prints construction-layout-window-private-float64:ok after exact observations.
type BufferStorage = ArrayBuffer;
type Samples = Float64Array;
class WindowStore {
  #data: Samples;
  constructor(buffer: BufferStorage, offset: number, size: number) { this.#data = new Float64Array(buffer, offset, size); }
  read(): Samples { return this.#data; }
}
const rows: readonly [number, number, readonly number[]][] = [[0, 2, [0, 0]], [8, 1, [0]], [16, 0, []]];
for (const [offset, size, expected] of rows) {
  const buffer: BufferStorage = new ArrayBuffer(16), data = new WindowStore(buffer, offset, size).read();
  const observed: number[] = [];
  assert.sameValue(data.buffer, buffer);
  assert.sameValue(data.byteOffset, offset);
  assert.sameValue(data.length, size);
  assert.sameValue(data.byteLength, size * 8);
  for (let i = 0; i < data.length; i++) observed[i] = data[i];
  assert.compareArray(observed, expected);
}
console.log("construction-layout-window-private-float64:ok");
