/*---
description: Control for buffers-transfer-interface-tracking-view; the tested view stays in a local variable of its exact type.
features: [ts-typed-array-contents, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-null-undefined, ts-interfaces, ts-objects]
---*/
// Replace the interface-held source with one local Uint8Array; source writes, transfer, destination resize history and assertions are unchanged.
function check(n: number): void {
  const buffer: ArrayBuffer = new ArrayBuffer(12, { maxByteLength: 20 });
  const view: Uint8Array = new Uint8Array(buffer, 3);
  view[0] = n; view[1] = 128; view[2] = 255; view[3] = 17;
  assert.sameValue(view.length, 9); assert.sameValue(view.byteOffset, 3); assert.sameValue(view.byteLength, 9);
  const original: number[] = [n, 128, 255, 17, 0, 0, 0, 0, 0];
  for (let i = 0; i < 9; i++) assert.sameValue(Object.is(view[i], original[i]), true);
  const moved: ArrayBuffer = buffer.transfer(6); view[0] = 255;
  assert.sameValue(buffer.byteLength, 0);
  assert.sameValue(view.length, 0); assert.sameValue(view.byteOffset, 0); assert.sameValue(view.byteLength, 0);
  for (let i = 0; i < 9; i++) assert.sameValue(Object.is(view[i], undefined), true);
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
