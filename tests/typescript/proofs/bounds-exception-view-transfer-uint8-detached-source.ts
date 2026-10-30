/*---
description: Exception effects on a Uint8Array view: transfer detaches the original view while the guarded old index is retained.
features: [ts-proof-bounds, ts-route-exception, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-errors, ts-class, ts-inheritance, ts-objects, ts-instanceof, ts-accessors, ts-closures]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the exception route.
// Transfer detaches the original view while the guarded old index is retained; node reads undefined after the change, otherwise 173.
function read(change: number): { value: number | undefined; caught: boolean } {
  const buffer = new ArrayBuffer(6);
  const view = new Uint8Array(buffer, 1, 3);
  const index = 2;
  view[index] = 173;
  class Changed extends Error {}
  const gate = { get signal(): number { if (change > 0) { buffer.transfer(8); throw new Changed(); } return 0; } };
  if (index < view.length) {
    let caught = false;
    try {
      const signal = gate.signal;
      if (signal !== 0) throw new Error("unexpected signal");
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
