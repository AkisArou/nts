/*---
description: Control for buffers-transfer-generic-fixed-view; the tested view stays in a local variable of its exact type.
features: [ts-typed-array-contents, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-null-undefined, ts-generics, ts-tuples]
---*/
// Replace the generic source-view parameter with one local Uint16Array; transfer, detached store and all assertions are unchanged.
function check(buffer: ArrayBuffer, n: number, lo: number, hi: number): void {
  const view: Uint16Array = new Uint16Array(buffer, 2, 2);
  const little = new Uint8Array(new Uint16Array([0x0102]).buffer)[0] === 2;
  view[0] = n; view[1] = 65535;
  assert.sameValue(view.length, 2); assert.sameValue(view.byteOffset, 2); assert.sameValue(view.byteLength, 4);
  assert.sameValue(Object.is(view[0], n), true); assert.sameValue(Object.is(view[1], 65535), true);
  const moved: ArrayBuffer = buffer.transfer(12);
  view[0] = n + 1;
  assert.sameValue(buffer.byteLength, 0); assert.sameValue(view.buffer, buffer);
  assert.sameValue(view.length, 0); assert.sameValue(view.byteOffset, 0); assert.sameValue(view.byteLength, 0);
  for (let i = 0; i < 2; i++) assert.sameValue(Object.is(view[i], undefined), true);
  const next: Uint16Array = new Uint16Array(moved, 2, 2);
  assert.sameValue(moved.byteLength, 12); assert.sameValue(moved.maxByteLength, 16); assert.sameValue(moved.resizable, true);
  assert.sameValue(next.length, 2); assert.sameValue(next.byteOffset, 2); assert.sameValue(next.byteLength, 4);
  assert.sameValue(Object.is(next[0], n), true); assert.sameValue(Object.is(next[1], 65535), true);
  const bytes: Uint8Array = new Uint8Array(moved);
  const expected: number[] = little ? [0, 0, lo, hi, 255, 255, 0, 0, 0, 0, 0, 0] : [0, 0, hi, lo, 255, 255, 0, 0, 0, 0, 0, 0];
  assert.sameValue(bytes.length, 12); assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.byteLength, 12);
  for (let i = 0; i < 12; i++) assert.sameValue(Object.is(bytes[i], expected[i]), true);
}
const rows: [number, number, number][] = [[0x1234, 52, 18], [0x8000, 0, 128], [0xffff, 255, 255]];
for (const [n, lo, hi] of rows) {
  const buffer: ArrayBuffer = new ArrayBuffer(8, { maxByteLength: 16 });
  check(buffer, n, lo, hi);
}
