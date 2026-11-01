/*---
description: Control for buffers-float64-generic-tracking-zeroes; the tested view stays in a local variable of its exact type.
features: [ts-typed-array-contents, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-null-undefined, ts-generics]
---*/
// Move the tested view allocation inside check as a local Float64Array; every resize, store and assertion is unchanged.
function check(buffer: ArrayBuffer, n: number): void {
  const view: Float64Array = new Float64Array(buffer);
  view[0] = -0; view[1] = NaN;
  for (const size of [16, 32, 8, 24]) {
    buffer.resize(size);
    if (size === 32) view[3] = n;
    if (size === 8) view[1] = n;
    const expected: number[] = size === 16 ? [-0, NaN] : size === 32 ? [-0, NaN, 0, n] : size === 8 ? [-0] : [-0, 0, 0];
    assert.sameValue(buffer.byteLength, size); assert.sameValue(buffer.maxByteLength, 40);
    assert.sameValue(view.length, size / 8); assert.sameValue(view.byteOffset, 0); assert.sameValue(view.byteLength, size);
    for (let i = 0; i < 4; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
  }
}
for (const n of [1.5, Infinity, NaN]) {
  const buffer: ArrayBuffer = new ArrayBuffer(16, { maxByteLength: 40 });
  check(buffer, n);
}
