/*---
description: An interface-held tracking view is detached by a shrinking transfer while the destination stays resizable and zeroes later regrowth.
features: [ts-typed-array-contents, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-null-undefined, ts-interfaces, ts-objects]
---*/
// Write an interface-held tracking view, transfer to fewer bytes, then resize the destination; node drops the tail and follows later sizes.
interface ContentsTransferSlot { view: Uint8Array; }
function check(n: number): void {
  const buffer: ArrayBuffer = new ArrayBuffer(12, { maxByteLength: 20 });
  const slot: ContentsTransferSlot = { view: new Uint8Array(buffer, 3) };
  slot.view[0] = n; slot.view[1] = 128; slot.view[2] = 255; slot.view[3] = 17;
  assert.sameValue(slot.view.length, 9); assert.sameValue(slot.view.byteOffset, 3); assert.sameValue(slot.view.byteLength, 9);
  const original: number[] = [n, 128, 255, 17, 0, 0, 0, 0, 0];
  for (let i = 0; i < 9; i++) assert.sameValue(Object.is(slot.view[i], original[i]), true);
  const moved: ArrayBuffer = buffer.transfer(6); slot.view[0] = 255;
  assert.sameValue(buffer.byteLength, 0);
  assert.sameValue(slot.view.length, 0); assert.sameValue(slot.view.byteOffset, 0); assert.sameValue(slot.view.byteLength, 0);
  for (let i = 0; i < 9; i++) assert.sameValue(Object.is(slot.view[i], undefined), true);
  const next: Uint8Array = new Uint8Array(moved, 3), sizes: number[] = [6, 10, 4, 10];
  for (let step = 0; step < sizes.length; step++) {
    const size = sizes[step]; moved.resize(size);
    const expected: number[] = step === 0 ? [n, 128, 255] : step === 1 ? [n, 128, 255, 0, 0, 0, 0] : step === 2 ? [n] : [n, 0, 0, 0, 0, 0, 0];
    assert.sameValue(moved.byteLength, size); assert.sameValue(moved.maxByteLength, 20); assert.sameValue(moved.resizable, true);
    assert.sameValue(next.length, expected.length); assert.sameValue(next.byteOffset, 3); assert.sameValue(next.byteLength, expected.length);
    for (let i = 0; i < 7; i++) assert.sameValue(Object.is(next[i], expected[i]), true);
    const bytes: Uint8Array = new Uint8Array(moved);
    assert.sameValue(bytes.length, size); assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.byteLength, size);
    for (let i = 0; i < size; i++) assert.sameValue(Object.is(bytes[i], i < 3 ? 0 : expected[i - 3]), true);
  }
}
for (const n of [1, 127, 255]) check(n);
