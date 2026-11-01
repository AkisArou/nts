/*---
description: An overlapping set through a union-typed view snapshots the source before writing.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-unions]
---*/
// Write through a Uint8Array-or-clamped parameter using its overlapping subarray; node preserves the original source sequence.
function check(view: Uint8Array | Uint8ClampedArray, n: number): void {
  view.set([n, 255, 0, 2, 3, 4]);
  const source = view.subarray(0, 4);
  view.set(source, 1);
  const expected = [n, n, 255, 0, 2, 4];
  assert.sameValue(view.length, 6);
  assert.sameValue(view.byteOffset, 2);
  assert.sameValue(view.byteLength, 6);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
  const sourceExpected = [n, n, 255, 0];
  assert.sameValue(source.length, 4);
  assert.sameValue(source.byteOffset, 2);
  assert.sameValue(source.byteLength, 4);
  for (let i = 0; i < sourceExpected.length; i++) assert.sameValue(Object.is(source[i], sourceExpected[i]), true);
  const bytes: Uint8Array = new Uint8Array(view.buffer);
  const byteExpected = [0, 0, n, n, 255, 0, 2, 4, 0];
  assert.sameValue(bytes.length, 9);
  assert.sameValue(bytes.byteOffset, 0);
  assert.sameValue(bytes.byteLength, 9);
  for (let i = 0; i < byteExpected.length; i++) assert.sameValue(Object.is(bytes[i], byteExpected[i]), true);
}
for (const n of [0, 127, 255]) check(new Uint8Array(new ArrayBuffer(9), 2, 6), n);
