/*---
description: Control for conversion-uint16-union-writer; the write uses one local Uint16Array directly.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-numbers]
---*/
// Paired case: ../typed-array-contents/conversion-uint16-union-writer.ts; only the parameter write is inlined into the exact local view.
const rows: [number, number][] = [
  [0, 0], [65535, 65535], [65536, 0], [-1, 65535], [65537, 1], [-65537, 65535], [2.9, 2], [-2.9, 65534],
  [-0, 0], [NaN, 0], [Infinity, 0], [-Infinity, 0],
];
for (const [input, expected] of rows) {
  const view: Uint16Array = new Uint16Array(new ArrayBuffer(12), 4, 3);
  view[0] = 17;
  view[2] = 27;
  view[1] = input;
  assert.sameValue(view.length, 3);
  assert.sameValue(view.byteOffset, 4);
  assert.sameValue(view.byteLength, 6);
  assert.sameValue(Object.is(view[0], 17), true);
  assert.sameValue(Object.is(view[1], expected), true);
  assert.sameValue(Object.is(view[2], 27), true);
}
