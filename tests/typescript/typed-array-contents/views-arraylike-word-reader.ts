/*---
description: A word view read through an ArrayLike interface sees writes made through its byte sibling.
features: [ts-typed-array-contents, ts-typed-array-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-interfaces, ts-interface-extends]
---*/
// Write Uint8 bytes; read a Uint16Array through an ArrayLike interface parameter; node uses the shared offset window.
interface ContentsArrayLike extends ArrayLike<number> { buffer: ArrayBufferLike; byteOffset: number; byteLength: number; }
function check(view: ContentsArrayLike, n: number): void {
  const little = new Uint8Array(new Uint16Array([0x0102]).buffer)[0] === 2;
  const bytes: Uint8Array = new Uint8Array(view.buffer, 4, 4);
  bytes[0] = n; bytes[1] = 0; bytes[2] = 0; bytes[3] = n;
  const expected: number[] = little ? [n, n * 256] : [n * 256, n], raw: number[] = [n, 0, 0, n];
  assert.sameValue(view.length, 2); assert.sameValue(view.byteOffset, 4); assert.sameValue(view.byteLength, 4);
  assert.sameValue(bytes.length, 4); assert.sameValue(bytes.byteOffset, 4); assert.sameValue(bytes.byteLength, 4);
  for (let i = 0; i < 2; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
  for (let i = 0; i < 4; i++) assert.sameValue(Object.is(bytes[i], raw[i]), true);
}
for (const n of [1, 127, 255]) check(new Uint16Array(new ArrayBuffer(12), 4, 2), n);
