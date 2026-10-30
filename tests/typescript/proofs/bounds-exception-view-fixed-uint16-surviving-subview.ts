/*---
description: Exception effects on a Uint16Array view: the original fixed subview survives a shrink to 6 bytes and reads a fresh sibling write.
features: [ts-proof-bounds, ts-route-exception, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects, ts-errors, ts-class, ts-inheritance, ts-instanceof]
---*/
// docs/foundations/objects.md, Typed arrays: index 1 is guarded before the exception route.
// The original fixed subview survives a shrink to 6 bytes and reads a fresh sibling write; node reads 4097 + change after the change, otherwise 50003.
function read(change: number): { value: number; caught: boolean; bytes: number } {
  const buffer = new ArrayBuffer(16, { maxByteLength: 20 });
  const view = new Uint16Array(buffer, 2, 2);
  const index = 1;
  view[index] = 50003;
  class Changed extends Error {}
  if (index < view.length) {
    let caught = false;
    try {
      if (change > 0) {
        buffer.resize(6);
        throw new Changed();
      }
    } catch (error) {
      if (!(error instanceof Changed)) throw error;
      caught = true;
    }
    finally {
      if (change > 0) {
        const sibling = new Uint16Array(buffer, 2, 2);
        sibling[index] = 4097 + change;
      }
    }
    return { value: view[index], caught, bytes: buffer.byteLength };
  }
  throw new Error("initial bounds");
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change > 0 ? 4097 + change : 50003);
  assert.sameValue(result.caught, change > 0);
  assert.sameValue(result.bytes, change > 0 ? 6 : 16);
}
