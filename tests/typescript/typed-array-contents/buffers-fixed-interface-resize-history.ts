/*---
description: An interface-held fixed Uint16Array becomes wholly out of bounds on shrink and recovers its retained prefix after regrowth.
features: [ts-typed-array-contents, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-null-undefined, ts-interfaces, ts-objects]
---*/
// Write a fixed view through an interface; resize up, below its end and up again; node ignores the out-of-bounds write and restores zeroed lost bytes.
interface ContentsFixedSlot { view: Uint16Array; }
function check(n: number): void {
  const buffer: ArrayBuffer = new ArrayBuffer(12, { maxByteLength: 20 });
  const slot: ContentsFixedSlot = { view: new Uint16Array(buffer, 2, 3) };
  slot.view[0] = n; slot.view[1] = 32768; slot.view[2] = 65535;
  for (const size of [12, 16, 6, 10]) {
    buffer.resize(size);
    if (size === 6) slot.view[0] = n + 100;
    const expected: number[] = size === 6 ? [] : [n, 32768, size === 10 ? 0 : 65535];
    assert.sameValue(buffer.byteLength, size); assert.sameValue(buffer.maxByteLength, 20);
    assert.sameValue(slot.view.length, expected.length);
    assert.sameValue(slot.view.byteOffset, size === 6 ? 0 : 2);
    assert.sameValue(slot.view.byteLength, expected.length * 2);
    for (let i = 0; i < 3; i++) assert.sameValue(Object.is(slot.view[i], expected[i]), true);
  }
}
for (const n of [1, 32768, 65535]) check(n);
