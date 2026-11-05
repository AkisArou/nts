/*---
description: Omitted lengths use the remaining buffer and become empty at its end.
features: [ts-typed-array-routes, ts-typed-array-route-construction, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-closures, ts-function-types, ts-arrow-functions, ts-readonly, ts-tuples]
---*/
// Omitted lengths use the remaining buffer and become empty at its end. Route: captured replaced window binding.
// Node prints construction-layout-window-end-captured:ok after exact observations.
type BufferStorage = ArrayBuffer;
type Samples = Int32Array;
const buffer: BufferStorage = new ArrayBuffer(8);
let data: Samples = new Int32Array(buffer);
const read: () => Samples = () => data;
const rows: readonly [number, readonly number[]][] = [[0, [0, 0]], [4, [0]], [8, []]];
for (const [offset, expected] of rows) {
  data = new Int32Array(buffer, offset);
  const view = read(), observed: number[] = [];
  assert.sameValue(view, data);
  assert.sameValue(view.buffer, buffer);
  assert.sameValue(view.byteOffset, offset);
  assert.sameValue(view.length, expected.length);
  assert.sameValue(view.byteLength, expected.length * 4);
  for (let i = 0; i < view.length; i++) observed[i] = view[i];
  assert.compareArray(observed, expected);
}
console.log("construction-layout-window-end-captured:ok");
