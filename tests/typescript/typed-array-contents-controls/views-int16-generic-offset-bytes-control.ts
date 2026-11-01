/*---
description: Control for views-int16-generic-offset-bytes; the tested view stays in a local variable of its exact type.
features: [ts-typed-array-contents, ts-typed-array-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-generics, ts-tuples]
---*/
// Replace the generic view parameter with one local Int16Array; inputs, writes and byte assertions are unchanged.
function check(n: number, signed: number, lo: number, hi: number): void {
  const view: Int16Array = new Int16Array(new ArrayBuffer(10), 4, 2);
  const little = new Uint8Array(new Uint16Array([0x0102]).buffer)[0] === 2;
  view[0] = n; view[1] = -1;
  assert.sameValue(view.length, 2); assert.sameValue(view.byteOffset, 4); assert.sameValue(view.byteLength, 4);
  assert.sameValue(Object.is(view[0], signed), true); assert.sameValue(Object.is(view[1], -1), true);
  const bytes: Uint8Array = new Uint8Array(view.buffer);
  const expected: number[] = little ? [0, 0, 0, 0, lo, hi, 255, 255, 0, 0] : [0, 0, 0, 0, hi, lo, 255, 255, 0, 0];
  assert.sameValue(bytes.length, 10); assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.byteLength, 10);
  for (let i = 0; i < 10; i++) assert.sameValue(Object.is(bytes[i], expected[i]), true);
}
const rows: [number, number, number, number][] = [[0x1234, 4660, 52, 18], [0x8000, -32768, 0, 128], [0xffff, -1, 255, 255]];
for (const [n, signed, lo, hi] of rows) check(n, signed, lo, hi);
