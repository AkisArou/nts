/*---
description: Callback effects on an Int32Array view: the original fixed subview survives a shrink to 12 bytes and reads a fresh sibling write.
features: [ts-proof-bounds, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects, ts-closures, ts-arrow-functions]
---*/
// docs/foundations/objects.md, Typed arrays: index 1 is guarded before the callback route.
// The original fixed subview survives a shrink to 12 bytes and reads a fresh sibling write; node reads -300 - change after the change, otherwise -123456789.
function read(change: number): { value: number; bytes: number } {
  const buffer = new ArrayBuffer(32, { maxByteLength: 40 });
  const view = new Int32Array(buffer, 4, 2);
  const index = 1;
  view[index] = -123456789;
  if (index < view.length) {
    Array.from([0, 1], step => {
      if (change > 0 && step === 1) {
        buffer.resize(12);
        const sibling = new Int32Array(buffer, 4, 2);
        sibling[index] = -300 - change;
      }
      return step;
    });
    return { value: view[index], bytes: buffer.byteLength };
  }
  throw new Error("initial bounds");
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change > 0 ? -300 - change : -123456789);
  assert.sameValue(result.bytes, change > 0 ? 12 : 32);
}
