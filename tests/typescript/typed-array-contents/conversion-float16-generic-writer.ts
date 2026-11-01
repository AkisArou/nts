/*---
description: Binary16 rounding, halfway ties, overflow, subnormals and signed underflow through a constrained generic writer.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-numbers, ts-generics, ts-generic-constraints]
---*/
// Write through a constrained generic parameter; read the exact local view; node converts the middle slot and preserves its guards.
function write<T extends Float16Array | Float32Array>(view: T, input: number): void {
  view[1] = input;
}
const rows: [number, number][] = [
  [0, 0], [-0, -0], [NaN, NaN], [Infinity, Infinity], [-Infinity, -Infinity], [0.1, 0.0999755859375],
  [1e40, Infinity], [-1e40, -Infinity], [65504, 65504], [65520, Infinity], [1.00048828125, 1],
  [1.00146484375, 1.001953125], [2 ** -24, 5.960464477539063e-8], [2 ** -25, 0], [-(2 ** -25), -0],
];
for (const [input, expected] of rows) {
  const view: Float16Array = new Float16Array(new ArrayBuffer(12), 4, 3);
  view[0] = 17;
  view[2] = 27;
  write(view, input);
  assert.sameValue(view.length, 3);
  assert.sameValue(view.byteOffset, 4);
  assert.sameValue(view.byteLength, 6);
  assert.sameValue(Object.is(view[0], 17), true);
  assert.sameValue(Object.is(view[1], expected), true);
  assert.sameValue(Object.is(view[2], 27), true);
}
