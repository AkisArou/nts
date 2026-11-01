/*---
description: One constrained generic writer is instantiated with Int16Array and Float32Array, preserving wrapping versus binary32 rounding, fractional values, overflow, NaN and signed zero.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-numbers, ts-generics, ts-generic-constraints]
---*/
// Both runtime view types enter the same typed writer; node converts each middle slot by its actual element type.
function write<T extends Int16Array | Float32Array>(view: T, input: number): void {
  view[1] = input;
}
const rows: [number, number, number][] = [
  [32768, -32768, 32768],
  [-32769, 32767, -32769],
  [0.1, 0, 0.10000000149011612],
  [2.5, 2, 2.5],
  [-2.5, -2, -2.5],
  [1e40, 0, Infinity],
  [NaN, 0, NaN],
  [-0, 0, -0],
  [Infinity, 0, Infinity],
];
for (const [input, firstExpected, secondExpected] of rows) {
  const integers: Int16Array = new Int16Array(new ArrayBuffer(12), 4, 3);
  integers[0] = 17; integers[2] = 27;
  const floats: Float32Array = new Float32Array(new ArrayBuffer(24), 8, 3);
  floats[0] = 17; floats[2] = 27;
  write<Int16Array>(integers, input);
  write<Float32Array>(floats, input);
  assert.sameValue(integers.length, 3);
  assert.sameValue(integers.byteOffset, 4);
  assert.sameValue(integers.byteLength, 6);
  assert.sameValue(Object.is(integers[0], 17), true);
  assert.sameValue(Object.is(integers[1], firstExpected), true);
  assert.sameValue(Object.is(integers[2], 27), true);
  assert.sameValue(floats.length, 3);
  assert.sameValue(floats.byteOffset, 8);
  assert.sameValue(floats.byteLength, 12);
  assert.sameValue(Object.is(floats[0], 17), true);
  assert.sameValue(Object.is(floats[1], secondExpected), true);
  assert.sameValue(Object.is(floats[2], 27), true);
}
