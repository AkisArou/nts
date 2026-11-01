/*---
description: Control for buffers-empty-class-offset-recovery; the tested view stays in a local variable of its exact type.
features: [ts-typed-array-contents, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-null-undefined, ts-class, ts-class-fields]
---*/
// Replace the class-held empty view with one local Uint8Array; sibling bytes, resize history and assertions are unchanged.
function check(n: number): void {
  const buffer: ArrayBuffer = new ArrayBuffer(8, { maxByteLength: 16 });
  const view: Uint8Array = new Uint8Array(buffer, 4, 0);
  const bytes: Uint8Array = new Uint8Array(buffer); bytes[4] = n;
  const sizes: number[] = [8, 16, 4, 3, 8];
  for (let step = 0; step < sizes.length; step++) {
    const size = sizes[step]; buffer.resize(size); view[0] = 255;
    assert.sameValue(buffer.byteLength, size); assert.sameValue(buffer.maxByteLength, 16);
    assert.sameValue(view.length, 0); assert.sameValue(view.byteLength, 0);
    assert.sameValue(view.byteOffset, size < 4 ? 0 : 4);
    assert.sameValue(Object.is(view[0], undefined), true);
    assert.sameValue(bytes.length, size); assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.byteLength, size);
    for (let i = 0; i < size; i++) assert.sameValue(Object.is(bytes[i], step < 2 && i === 4 ? n : 0), true);
  }
}
for (const n of [1, 128, 255]) check(n);
