/*---
description: Exception effects on a Uint16Array view: transfer rebinds the view to the copied destination before its valid element is updated.
features: [ts-proof-bounds, ts-route-exception, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects, ts-errors, ts-class, ts-inheritance, ts-instanceof]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the exception route.
// Transfer rebinds the view to the copied destination before its valid element is updated; node reads 50003 + (7 + change) after the change, otherwise 50003.
function read(change: number): { value: number; caught: boolean } {
  const buffer = new ArrayBuffer(12, { maxByteLength: 20 });
  let view = new Uint16Array(buffer, 2, 3);
  const index = 2;
  view[index] = 50003;
  class Changed extends Error {}
  if (index < view.length) {
    let caught = false;
    try {
      if (change > 0) {
        const moved = buffer.transferToFixedLength(16);
        view = new Uint16Array(moved, 2, 3);
        view[index] += 7 + change;
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
  assert.sameValue(result.value, change > 0 ? 50003 + (7 + change) : 50003);
  assert.sameValue(result.caught, change > 0);
}
