/*---
description: Signed 8-bit wrapping, truncation and nonfinite-to-zero conversion through a constrained generic writer.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-numbers, ts-generics, ts-generic-constraints]
---*/
// Write through a constrained generic parameter; read the exact local view; node converts the middle slot and preserves its guards.
function write<T extends Int8Array | Uint8Array>(view: T, input: number): void {
  view[1] = input;
}
const rows: [number, number][] = [
  [-128, -128], [127, 127], [128, -128], [255, -1], [256, 0], [-129, 127], [2.9, 2], [-2.9, -2], [-0, 0],
  [NaN, 0], [Infinity, 0], [-Infinity, 0],
];
for (const [input, expected] of rows) {
  const view: Int8Array = new Int8Array(new ArrayBuffer(6), 2, 3);
  view[0] = 17;
  view[2] = 27;
  write(view, input);
  assert.sameValue(view.length, 3);
  assert.sameValue(view.byteOffset, 2);
  assert.sameValue(view.byteLength, 3);
  assert.sameValue(Object.is(view[0], 17), true);
  assert.sameValue(Object.is(view[1], expected), true);
  assert.sameValue(Object.is(view[2], 27), true);
}
