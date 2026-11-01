/*---
description: Control for conversion-int16-generic-writer; the write uses one local Int16Array directly.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-numbers, ts-generics, ts-generic-constraints]
---*/
// Paired case: ../typed-array-contents/conversion-int16-generic-writer.ts; only the parameter write is inlined into the exact local view.
const rows: [number, number][] = [
  [32767, 32767], [32768, -32768], [-32768, -32768], [-32769, 32767], [65535, -1], [65536, 0], [2.9, 2],
  [-2.9, -2], [-0, 0], [NaN, 0], [Infinity, 0], [-Infinity, 0],
];
for (const [input, expected] of rows) {
  const view: Int16Array = new Int16Array(new ArrayBuffer(12), 4, 3);
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
