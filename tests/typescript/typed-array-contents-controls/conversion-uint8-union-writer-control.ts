/*---
description: Control for conversion-uint8-union-writer; the write uses one local Uint8Array directly.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-numbers]
---*/
// Paired case: ../typed-array-contents/conversion-uint8-union-writer.ts; only the parameter write is inlined into the exact local view.
const rows: [number, number][] = [
  [0, 0], [-0, 0], [255, 255], [256, 0], [-1, 255], [257, 1], [-257, 255], [2.9, 2], [-2.9, 254],
  [NaN, 0], [Infinity, 0], [-Infinity, 0],
];
for (const [input, expected] of rows) {
  const view: Uint8Array = new Uint8Array(new ArrayBuffer(6), 2, 3);
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
