/*---
description: Exception effects on an Int32Array view: the offset tracking view loses index 2 when its buffer shrinks to 15 bytes.
features: [ts-proof-bounds, ts-route-exception, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects, ts-errors, ts-class, ts-inheritance, ts-instanceof, ts-closures]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the exception route.
// The offset tracking view loses index 2 when its buffer shrinks to 15 bytes; node reads undefined after the change, otherwise -123456789.
function read(change: number): { value: number | undefined; caught: boolean } {
  const buffer = new ArrayBuffer(24, { maxByteLength: 40 });
  const view = new Int32Array(buffer, 8);
  const index = 2;
  view[index] = -123456789;
  class Changed extends Error {}
  function update(): void { if (change > 0) { buffer.resize(15); throw new Changed(); } }
  if (index < view.length) {
    let caught = false;
    try {
      update();
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
  assert.sameValue(result.value, change > 0 ? undefined : -123456789);
  assert.sameValue(result.caught, change > 0);
}
