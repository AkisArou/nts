/*---
description: Control for conversion-uint8-clamped-generic-writer; the write uses one local Uint8ClampedArray directly.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-numbers, ts-generics, ts-generic-constraints]
---*/
// Paired case: ../typed-array-contents/conversion-uint8-clamped-generic-writer.ts; only the parameter write is inlined into the exact local view.
const rows: [number, number][] = [
  [-1, 0], [0, 0], [-0, 0], [255, 255], [256, 255], [0.5, 0], [1.5, 2], [2.5, 2], [3.5, 4], [254.5, 254],
  [255.5, 255], [NaN, 0], [Infinity, 255], [-Infinity, 0],
];
for (const [input, expected] of rows) {
  const view: Uint8ClampedArray = new Uint8ClampedArray(new ArrayBuffer(6), 2, 3);
  view[0] = 17;
  view[2] = 27;
  view[1] = input;
  assert.sameValue(view.length, 3);
  assert.sameValue(view.byteOffset, 2);
  assert.sameValue(view.byteLength, 3);
  assert.sameValue(Object.is(view[0], 17), true);
  assert.sameValue(Object.is(view[1], expected), true);
  assert.sameValue(Object.is(view[2], 27), true);
}
