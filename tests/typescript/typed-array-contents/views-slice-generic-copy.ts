/*---
description: A slice made through a constrained Uint16Array parameter remains independent after writes to both views.
features: [ts-typed-array-contents, ts-typed-array-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-generics]
---*/
// Write a generic source and its slice; node gives the copy separate storage and a zero byte offset.
function check<V extends Uint16Array>(view: V, n: number): void {
  for (let i = 0; i < 5; i++) view[i] = n + i;
  const copy: Uint16Array = view.slice(1, 4);
  const original: number[] = [n, n + 1, n + 2, n + 3, n + 4];
  for (let i = 0; i < 5; i++) assert.sameValue(Object.is(view[i], original[i]), true);
  for (let i = 0; i < 3; i++) assert.sameValue(Object.is(copy[i], original[i + 1]), true);
  copy[0] = 65537; view[2] = 65535;
  assert.sameValue(copy.buffer === view.buffer, false);
  assert.sameValue(view.length, 5); assert.sameValue(view.byteOffset, 2); assert.sameValue(view.byteLength, 10);
  assert.sameValue(copy.length, 3); assert.sameValue(copy.byteOffset, 0); assert.sameValue(copy.byteLength, 6);
  const expected: number[] = [n, n + 1, 65535, n + 3, n + 4], copied: number[] = [1, n + 2, n + 3];
  for (let i = 0; i < 5; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
  for (let i = 0; i < 3; i++) assert.sameValue(Object.is(copy[i], copied[i]), true);
}
for (const n of [0, 32768, 65530]) check(new Uint16Array(new ArrayBuffer(14), 2, 5), n);
