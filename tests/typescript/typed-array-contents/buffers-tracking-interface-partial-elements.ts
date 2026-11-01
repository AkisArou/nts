/*---
description: An interface-held tracking Uint16Array follows whole elements through odd sizes and converts a surviving post-shrink write.
features: [ts-typed-array-contents, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-null-undefined, ts-interfaces, ts-objects]
---*/
// Write a tracking interface field across six buffer sizes; node floors partial elements, distinguishes empty from out of bounds, and zeroes discarded storage.
interface ContentsTrackingSlot { view: Uint16Array; }
function check(n: number): void {
  const buffer: ArrayBuffer = new ArrayBuffer(12, { maxByteLength: 20 });
  const slot: ContentsTrackingSlot = { view: new Uint16Array(buffer, 4) };
  slot.view[0] = n;
  const sizes: number[] = [12, 15, 7, 4, 3, 12];
  for (let step = 0; step < sizes.length; step++) {
    const size = sizes[step]; buffer.resize(size);
    if (size === 15) slot.view[4] = 65535;
    if (size === 7) { slot.view[0] = n + 1; slot.view[2] = 65535; }
    if (size === 3) slot.view[0] = 65535;
    const length = size < 4 ? 0 : Math.floor((size - 4) / 2);
    const expected: number[] = step === 0 ? [n, 0, 0, 0] : step === 1 ? [n, 0, 0, 0, 65535] : step === 2 ? [n === 65535 ? 0 : n + 1] : step === 5 ? [0, 0, 0, 0] : [];
    assert.sameValue(buffer.byteLength, size); assert.sameValue(buffer.maxByteLength, 20);
    assert.sameValue(slot.view.length, length); assert.sameValue(slot.view.byteLength, length * 2);
    assert.sameValue(slot.view.byteOffset, size < 4 ? 0 : 4);
    for (let i = 0; i < 5; i++) assert.sameValue(Object.is(slot.view[i], expected[i]), true);
  }
}
for (const n of [1, 32768, 65535]) check(n);
