/*---
description: Binary32 rounding, halfway ties, overflow, subnormals and signed underflow through a union writer.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-numbers]
---*/
// Write through a union parameter; read the exact local view; node converts the middle slot and preserves its guards.
function write(view: Float32Array | Float64Array, input: number): void {
  view[1] = input;
}
const rows: [number, number][] = [
  [0, 0], [-0, -0], [NaN, NaN], [Infinity, Infinity], [-Infinity, -Infinity], [0.1, 0.10000000149011612],
  [1e40, Infinity], [-1e40, -Infinity], [16777217, 16777216], [16777219, 16777220],
  [1.0000000596046448, 1], [1.0000001788139343, 1.000000238418579], [2 ** -149, 1.401298464324817e-45],
  [2 ** -150, 0], [-(2 ** -150), -0],
];
for (const [input, expected] of rows) {
  const view: Float32Array = new Float32Array(new ArrayBuffer(24), 8, 3);
  view[0] = 17;
  view[2] = 27;
  write(view, input);
  assert.sameValue(view.length, 3);
  assert.sameValue(view.byteOffset, 8);
  assert.sameValue(view.byteLength, 12);
  assert.sameValue(Object.is(view[0], 17), true);
  assert.sameValue(Object.is(view[1], expected), true);
  assert.sameValue(Object.is(view[2], 27), true);
}
