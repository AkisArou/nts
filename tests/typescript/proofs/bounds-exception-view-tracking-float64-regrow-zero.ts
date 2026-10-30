/*---
description: Exception effects on a Float64Array view: shrink then growth to 64 bytes restores a valid index with zeroed lost bytes.
features: [ts-proof-bounds, ts-route-exception, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects, ts-errors, ts-class, ts-inheritance, ts-instanceof]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the exception route.
// Shrink then growth to 64 bytes restores a valid index with zeroed lost bytes; node reads 0 after the change, otherwise -12.5.
function read(change: number): { value: number; caught: boolean } {
  const buffer = new ArrayBuffer(48, { maxByteLength: 80 });
  const view = new Float64Array(buffer, 16);
  const index = 2;
  view[index] = -12.5;
  class Changed extends Error {}
  if (index < view.length) {
    let caught = false;
    try {
      if (change > 0) { buffer.resize(24); throw new Changed(); }
    } catch (error) {
      if (!(error instanceof Changed)) throw error;
      caught = true;
      buffer.resize(64);
    }
    return { value: view[index], caught };
  }
  throw new Error("initial bounds");
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change > 0 ? 0 : -12.5);
  assert.sameValue(result.caught, change > 0);
}
