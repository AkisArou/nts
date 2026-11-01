/*---
description: Control for buffers-fixed-interface-resize-history; the tested view stays in a local variable of its exact type.
features: [ts-typed-array-contents, ts-typed-array-buffers, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-null-undefined, ts-interfaces, ts-objects]
---*/
// Replace the interface field with one local fixed Uint16Array; resize history, writes and assertions are unchanged.
function check(n: number): void {
  const buffer: ArrayBuffer = new ArrayBuffer(12, { maxByteLength: 20 });
  const view: Uint16Array = new Uint16Array(buffer, 2, 3);
  view[0] = n; view[1] = 32768; view[2] = 65535;
  for (const size of [12, 16, 6, 10]) {
    buffer.resize(size);
    if (size === 6) view[0] = n + 100;
    const expected: number[] = size === 6 ? [] : [n, 32768, size === 10 ? 0 : 65535];
    assert.sameValue(buffer.byteLength, size); assert.sameValue(buffer.maxByteLength, 20);
    assert.sameValue(view.length, expected.length);
    assert.sameValue(view.byteOffset, size === 6 ? 0 : 2);
    assert.sameValue(view.byteLength, expected.length * 2);
    for (let i = 0; i < 3; i++) assert.sameValue(Object.is(view[i], expected[i]), true);
  }
}
for (const n of [1, 32768, 65535]) check(n);
