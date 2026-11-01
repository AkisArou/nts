/*---
description: Control for conversion-union-wrapping-clamping-dispatch; both writes stay in exact local view declarations.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-numbers]
---*/
// Paired case: ../typed-array-contents/conversion-union-wrapping-clamping-dispatch.ts; inline both writes, keeping inputs and assertions unchanged.
const rows: [number, number, number][] = [
  [256, 0, 255],
  [-1, 255, 0],
  [2.5, 2, 2],
  [3.5, 3, 4],
  [254.5, 254, 254],
  [255.5, 255, 255],
  [NaN, 0, 0],
  [Infinity, 0, 255],
  [-Infinity, 0, 0],
  [-0, 0, 0],
];
for (const [input, firstExpected, secondExpected] of rows) {
  const wrapped: Uint8Array = new Uint8Array(new ArrayBuffer(6), 2, 3);
  wrapped[0] = 17; wrapped[2] = 27;
  const clamped: Uint8ClampedArray = new Uint8ClampedArray(new ArrayBuffer(6), 2, 3);
  clamped[0] = 17; clamped[2] = 27;
  wrapped[1] = input;
  clamped[1] = input;
  assert.sameValue(wrapped.length, 3);
  assert.sameValue(wrapped.byteOffset, 2);
  assert.sameValue(wrapped.byteLength, 3);
  assert.sameValue(Object.is(wrapped[0], 17), true);
  assert.sameValue(Object.is(wrapped[1], firstExpected), true);
  assert.sameValue(Object.is(wrapped[2], 27), true);
  assert.sameValue(clamped.length, 3);
  assert.sameValue(clamped.byteOffset, 2);
  assert.sameValue(clamped.byteLength, 3);
  assert.sameValue(Object.is(clamped[0], 17), true);
  assert.sameValue(Object.is(clamped[1], secondExpected), true);
  assert.sameValue(Object.is(clamped[2], 27), true);
}
