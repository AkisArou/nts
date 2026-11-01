/*---
description: Control for views-arraylike-word-reader; the tested view stays in a local variable of its exact type.
features: [ts-typed-array-contents, ts-typed-array-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-interfaces, ts-interface-extends]
---*/
// Replace the ArrayLike view parameter with one local Uint16Array; byte writes and element/metadata assertions are unchanged.
function check(n: number): void {
  const view: Uint16Array = new Uint16Array(new ArrayBuffer(12), 4, 2);
  const little = new Uint8Array(new Uint16Array([0x0102]).buffer)[0] === 2;
  const bytes: Uint8Array = new Uint8Array(view.buffer, 4, 4);
  bytes[0] = n; bytes[1] = 0; bytes[2] = 0; bytes[3] = n;
  const expected: number[] = little ? [n, n * 256] : [n * 256, n], raw: number[] = [n, 0, 0, n];
  assert.sameValue(view.length, 2); assert.sameValue(view.byteOffset, 4); assert.sameValue(view.byteLength, 4);
  assert.sameValue(bytes.length, 4); assert.sameValue(bytes.byteOffset, 4); assert.sameValue(bytes.byteLength, 4);
  for (let i = 0; i < 2; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
  for (let i = 0; i < 4; i++) assert.sameValue(Object.is(bytes[i], raw[i]), true);
}
for (const n of [1, 127, 255]) check(n);
