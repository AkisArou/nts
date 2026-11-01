/*---
description: Signed 16-bit wrapping, truncation and nonfinite-to-zero conversion through a constrained generic writer.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-numbers, ts-generics, ts-generic-constraints]
---*/
// Write through a constrained generic parameter; read the exact local view; node converts the middle slot and preserves its guards.
function write<T extends Int16Array | Uint16Array>(view: T, input: number): void {
  view[1] = input;
}
const rows: [number, number][] = [
  [32767, 32767], [32768, -32768], [-32768, -32768], [-32769, 32767], [65535, -1], [65536, 0], [2.9, 2],
  [-2.9, -2], [-0, 0], [NaN, 0], [Infinity, 0], [-Infinity, 0],
];
for (const [input, expected] of rows) {
  const view: Int16Array = new Int16Array(new ArrayBuffer(12), 4, 3);
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
