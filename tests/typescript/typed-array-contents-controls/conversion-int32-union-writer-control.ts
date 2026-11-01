/*---
description: Control for conversion-int32-union-writer; the write uses one local Int32Array directly.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-numbers]
---*/
// Paired case: ../typed-array-contents/conversion-int32-union-writer.ts; only the parameter write is inlined into the exact local view.
const rows: [number, number][] = [
  [2147483647, 2147483647], [2147483648, -2147483648], [-2147483648, -2147483648],
  [-2147483649, 2147483647], [4294967295, -1], [4294967296, 0], [4294967297, 1], [-4294967297, -1],
  [2.9, 2], [-2.9, -2], [-0, 0], [NaN, 0], [Infinity, 0], [-Infinity, 0],
];
for (const [input, expected] of rows) {
  const view: Int32Array = new Int32Array(new ArrayBuffer(24), 8, 3);
  view[0] = 17;
  view[2] = 27;
  view[1] = input;
  assert.sameValue(view.length, 3);
  assert.sameValue(view.byteOffset, 8);
  assert.sameValue(view.byteLength, 12);
  assert.sameValue(Object.is(view[0], 17), true);
  assert.sameValue(Object.is(view[1], expected), true);
  assert.sameValue(Object.is(view[2], 27), true);
}
