/*---
description: Control for views-float32-interface-bits; the tested view stays in a local variable of its exact type.
features: [ts-typed-array-contents, ts-typed-array-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-interfaces, ts-objects, ts-tuples]
---*/
// Replace the interface field with one local Float32Array; all writes, sibling views and assertions are unchanged.
function check(n: number, word: number, a: number, b: number, c: number, d: number): void {
  const view: Float32Array = new Float32Array(new ArrayBuffer(12), 4, 1);
  const little = new Uint8Array(new Uint16Array([0x0102]).buffer)[0] === 2;
  view[0] = n;
  const bits: Int32Array = new Int32Array(view.buffer, 4, 1);
  assert.sameValue(view.length, 1); assert.sameValue(view.byteOffset, 4); assert.sameValue(view.byteLength, 4);
  assert.sameValue(Object.is(view[0], n), true);
  assert.sameValue(bits.length, 1); assert.sameValue(bits.byteOffset, 4); assert.sameValue(bits.byteLength, 4);
  assert.sameValue(Object.is(bits[0], word), true);
  const bytes: Uint8Array = new Uint8Array(view.buffer);
  const expected: number[] = little ? [0, 0, 0, 0, d, c, b, a, 0, 0, 0, 0] : [0, 0, 0, 0, a, b, c, d, 0, 0, 0, 0];
  assert.sameValue(bytes.length, 12); assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.byteLength, 12);
  for (let i = 0; i < 12; i++) assert.sameValue(Object.is(bytes[i], expected[i]), true);
}
const rows: [number, number, number, number, number, number][] = [[-0, -2147483648, 128, 0, 0, 0], [1.5, 1069547520, 63, 192, 0, 0], [-Infinity, -8388608, 255, 128, 0, 0]];
for (const [n, word, a, b, c, d] of rows) check(n, word, a, b, c, d);
