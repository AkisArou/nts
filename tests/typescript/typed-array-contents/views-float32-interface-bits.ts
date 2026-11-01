/*---
description: A Float32Array held in an interface shares its signed-zero and infinity bits with integer and byte views.
features: [ts-typed-array-contents, ts-typed-array-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-interfaces, ts-objects, ts-tuples]
---*/
// Write an interface field; read signed integer bits and every raw byte; node preserves the Float32 representation.
interface ContentsFloatSlot { view: Float32Array; }
function check(n: number, word: number, a: number, b: number, c: number, d: number): void {
  const slot: ContentsFloatSlot = { view: new Float32Array(new ArrayBuffer(12), 4, 1) };
  const little = new Uint8Array(new Uint16Array([0x0102]).buffer)[0] === 2;
  slot.view[0] = n;
  const bits: Int32Array = new Int32Array(slot.view.buffer, 4, 1);
  assert.sameValue(slot.view.length, 1); assert.sameValue(slot.view.byteOffset, 4); assert.sameValue(slot.view.byteLength, 4);
  assert.sameValue(Object.is(slot.view[0], n), true);
  assert.sameValue(bits.length, 1); assert.sameValue(bits.byteOffset, 4); assert.sameValue(bits.byteLength, 4);
  assert.sameValue(Object.is(bits[0], word), true);
  const bytes: Uint8Array = new Uint8Array(slot.view.buffer);
  const expected: number[] = little ? [0, 0, 0, 0, d, c, b, a, 0, 0, 0, 0] : [0, 0, 0, 0, a, b, c, d, 0, 0, 0, 0];
  assert.sameValue(bytes.length, 12); assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.byteLength, 12);
  for (let i = 0; i < 12; i++) assert.sameValue(Object.is(bytes[i], expected[i]), true);
}
const rows: [number, number, number, number, number, number][] = [[-0, -2147483648, 128, 0, 0, 0], [1.5, 1069547520, 63, 192, 0, 0], [-Infinity, -8388608, 255, 128, 0, 0]];
for (const [n, word, a, b, c, d] of rows) check(n, word, a, b, c, d);
