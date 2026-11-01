/*---
description: An offset DataView parameter writes and reads unaligned Uint16 values in both byte orders beside a byte view.
features: [ts-typed-array-contents, ts-typed-array-views, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-tuples]
---*/
// Write and read through a DataView parameter; node exposes the requested byte order in the Uint8Array sibling.
function check(view: DataView, n: number, lo: number, hi: number, little: boolean): void {
  view.setUint16(1, n, little);
  assert.sameValue(Object.is(view.getUint16(1, little), n), true);
  assert.sameValue(Object.is(view.getUint16(1, !little), lo * 256 + hi), true);
  assert.sameValue(view.byteOffset, 2); assert.sameValue(view.byteLength, 6);
  const bytes: Uint8Array = new Uint8Array(view.buffer);
  const expected: number[] = little ? [0, 0, 0, lo, hi, 0, 0, 0, 0, 0] : [0, 0, 0, hi, lo, 0, 0, 0, 0, 0];
  assert.sameValue(bytes.length, 10); assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.byteLength, 10);
  for (let i = 0; i < 10; i++) assert.sameValue(Object.is(bytes[i], expected[i]), true);
}
const rows: [number, number, number][] = [[0x1234, 52, 18], [0x80ff, 255, 128], [0xffff, 255, 255]];
for (const [n, lo, hi] of rows) for (const little of [false, true]) check(new DataView(new ArrayBuffer(10), 2, 6), n, lo, hi, little);
