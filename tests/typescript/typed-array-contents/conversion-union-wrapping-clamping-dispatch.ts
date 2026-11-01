/*---
description: One union writer receives both Uint8Array and Uint8ClampedArray, preserving wrapping versus clamping, half-even ties and nonfinite conversions.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-numbers]
---*/
// Both runtime view types enter the same typed writer; node converts each middle slot by its actual element type.
function write(view: Uint8Array | Uint8ClampedArray, input: number): void {
  view[1] = input;
}
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
  write(wrapped, input);
  write(clamped, input);
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
