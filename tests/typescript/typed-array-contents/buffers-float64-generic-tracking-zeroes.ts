/*---
description: A generic tracking Float64Array keeps signed zero while discarded NaN and later stores become positive zero after regrowth.
features: [ts-typed-array-contents, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-null-undefined, ts-generics]
---*/
// Write a generic tracking Float64Array before and after resizing; node preserves retained -0 and clears truncated bytes despite an ignored write.
function check<V extends Float64Array>(view: V, buffer: ArrayBuffer, n: number): void {
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
  check(new Float64Array(buffer), buffer, n);
}
