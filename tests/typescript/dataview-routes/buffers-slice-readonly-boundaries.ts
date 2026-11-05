/*---
description: "Slice normalizes negative fractional infinite and reversed bounds into an independent byte range through readonly tuples of slice boundaries."
features: [ts-dataview-routes, ts-dataview-route-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-type-aliases, ts-objects, ts-readonly, ts-tuples, ts-unions, ts-null-undefined]
---*/

// Slice normalizes negative fractional infinite and reversed bounds into an independent byte range; route: readonly tuples of slice boundaries.
// Node prints buffers-slice-readonly-boundaries:ok.
type BufferStorage = ArrayBuffer;
type View = DataView<ArrayBuffer>;
const rows: readonly [number, number | undefined, readonly number[]][] = [
  [-1, undefined, [5]], [3, 1, []], [-9, 99, [1, 2, 3, 4, 5]], [1.9, 4.9, [2, 3, 4]],
  [NaN, 2, [1, 2]], [Infinity, undefined, []], [-Infinity, Infinity, [1, 2, 3, 4, 5]], [0, 0, []]
];
for (const [start, end, expected] of rows) {
  const source: BufferStorage = new ArrayBuffer(5), before: View = new DataView(source);
  for (let i = 0; i < 5; i++) before.setUint8(i, i + 1);
  const copy = source.slice(start, end), view: View = new DataView(copy);
  assert.sameValue(copy === source, false); assert.sameValue(copy.byteLength, expected.length);
  const bytes: number[] = []; for (let i = 0; i < view.byteLength; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, expected); assert.sameValue(source.byteLength, 5);
}
console.log("buffers-slice-readonly-boundaries:ok");
