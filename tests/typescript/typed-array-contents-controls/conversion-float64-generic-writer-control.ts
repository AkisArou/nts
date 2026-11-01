/*---
description: Control for conversion-float64-generic-writer; the write uses one local Float64Array directly.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-numbers, ts-generics, ts-generic-constraints]
---*/
// Paired case: ../typed-array-contents/conversion-float64-generic-writer.ts; only the parameter write is inlined into the exact local view.
const rows: [number, number][] = [
  [0, 0], [-0, -0], [NaN, NaN], [Infinity, Infinity], [-Infinity, -Infinity], [0.1, 0.1], [1e40, 1e40],
  [-1e40, -1e40], [9007199254740994, 9007199254740994], [5e-324, 5e-324], [-5e-324, -5e-324],
  [1.7976931348623157e308, 1.7976931348623157e308],
];
for (const [input, expected] of rows) {
  const view: Float64Array = new Float64Array(new ArrayBuffer(48), 16, 3);
  view[0] = 17;
  view[2] = 27;
  view[1] = input;
  assert.sameValue(view.length, 3);
  assert.sameValue(view.byteOffset, 16);
  assert.sameValue(view.byteLength, 24);
  assert.sameValue(Object.is(view[0], 17), true);
  assert.sameValue(Object.is(view[1], expected), true);
  assert.sameValue(Object.is(view[2], 27), true);
}
