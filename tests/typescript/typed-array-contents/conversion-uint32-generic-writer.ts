/*---
description: Unsigned 32-bit values above 2^31, wrapping, truncation and nonfinite-to-zero conversion through a constrained generic writer.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-numbers, ts-generics, ts-generic-constraints]
---*/
// Write through a constrained generic parameter; read the exact local view; node converts the middle slot and preserves its guards.
function write<T extends Uint32Array | Int32Array>(view: T, input: number): void {
  view[1] = input;
}
const rows: [number, number][] = [
  [2147483647, 2147483647], [2147483648, 2147483648], [4294967295, 4294967295], [4294967296, 0],
  [4294967297, 1], [-1, 4294967295], [-4294967297, 4294967295], [2.9, 2], [-2.9, 4294967294], [-0, 0],
  [NaN, 0], [Infinity, 0], [-Infinity, 0],
];
for (const [input, expected] of rows) {
  const view: Uint32Array = new Uint32Array(new ArrayBuffer(24), 8, 3);
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
