/*---
description: Unsigned 16-bit wrapping, truncation and nonfinite-to-zero conversion through a union writer.
features: [ts-typed-array-contents, ts-typed-array-conversion, ts-arrays, ts-functions, ts-iteration, ts-tuples, ts-unions, ts-numbers]
---*/
// Write through a union parameter; read the exact local view; node converts the middle slot and preserves its guards.
function write(view: Uint16Array | Int16Array, input: number): void {
  view[1] = input;
}
const rows: [number, number][] = [
  [0, 0], [65535, 65535], [65536, 0], [-1, 65535], [65537, 1], [-65537, 65535], [2.9, 2], [-2.9, 65534],
  [-0, 0], [NaN, 0], [Infinity, 0], [-Infinity, 0],
];
for (const [input, expected] of rows) {
  const view: Uint16Array = new Uint16Array(new ArrayBuffer(12), 4, 3);
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
