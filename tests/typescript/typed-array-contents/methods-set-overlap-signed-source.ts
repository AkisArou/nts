/*---
description: Overlapping set converts signed source elements before destination writes can change them.
features: [ts-typed-array-contents, ts-typed-array-methods, ts-arrays, ts-functions, ts-iteration, ts-numbers]
---*/
// Write through a Uint8Array parameter from an overlapping Int8Array; node snapshots signed elements and wraps them to bytes.
function check(view: Uint8Array, n: number): void {
  view.set([0, 0, 0, 0, 0, 0]);
  const source: Int8Array = new Int8Array(view.buffer, 1, 4);
  source.set([-1, n, -128, 127]);
  view.set(source, 2);
  const expected = [0, 255, 255, n, 128, 127];
  assert.sameValue(view.length, 6);
  assert.sameValue(view.byteOffset, 0);
  assert.sameValue(view.byteLength, 6);
  for (let i = 0; i < expected.length; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
  const sourceExpected = [-1, -1, n, -128];
  assert.sameValue(source.length, 4);
  assert.sameValue(source.byteOffset, 1);
  assert.sameValue(source.byteLength, 4);
  for (let i = 0; i < sourceExpected.length; i++) assert.sameValue(Object.is(source[i], sourceExpected[i]), true);
  const bytes: Uint8Array = new Uint8Array(view.buffer);
  const byteExpected = [0, 255, 255, n, 128, 127, 0];
  assert.sameValue(bytes.length, 7);
  assert.sameValue(bytes.byteOffset, 0);
  assert.sameValue(bytes.byteLength, 7);
  for (let i = 0; i < byteExpected.length; i++) assert.sameValue(Object.is(bytes[i], byteExpected[i]), true);
}
for (const n of [0, 1, 127]) check(new Uint8Array(new ArrayBuffer(7), 0, 6), n);
