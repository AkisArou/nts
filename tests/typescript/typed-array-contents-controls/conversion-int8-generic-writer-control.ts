/*---
description: Control for conversion-int8-generic-writer; the write uses one local Int8Array directly.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-numbers, ts-generics, ts-generic-constraints]
---*/
// Paired case: ../typed-array-contents/conversion-int8-generic-writer.ts; only the parameter write is inlined into the exact local view.
const rows: [number, number][] = [
  [-128, -128], [127, 127], [128, -128], [255, -1], [256, 0], [-129, 127], [2.9, 2], [-2.9, -2], [-0, 0],
  [NaN, 0], [Infinity, 0], [-Infinity, 0],
];
for (const [input, expected] of rows) {
  const view: Int8Array = new Int8Array(new ArrayBuffer(6), 2, 3);
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
