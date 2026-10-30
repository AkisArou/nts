/*---
description: Exception effects on a Uint8Array view: shrinking to 4 bytes invalidates the whole fixed view although the indexed bytes survive.
features: [ts-proof-bounds, ts-route-exception, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects, ts-errors, ts-class, ts-inheritance, ts-instanceof]
---*/
// docs/foundations/objects.md, Typed arrays: index 1 is guarded before the exception route.
// Shrinking to 4 bytes invalidates the whole fixed view although the indexed bytes survive; node reads undefined after the change, otherwise 173.
function read(change: number): { value: number | undefined; caught: boolean } {
  const buffer = new ArrayBuffer(8, { maxByteLength: 10 });
  const view = new Uint8Array(buffer, 2, 3);
  const index = 1;
  view[index] = 173;
  class Changed extends Error {}
  if (index < view.length) {
    let caught = false;
    try {
      if (change > 0) {
        buffer.resize(4);
        throw new Changed();
      }
    } catch (error) {
      if (!(error instanceof Changed)) throw error;
      caught = true;
    }
    return { value: view[index], caught };
  }
  throw new Error("initial bounds");
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result.value, change > 0 ? undefined : 173);
  assert.sameValue(result.caught, change > 0);
}
