/*---
description: Call effects on an Int32Array view: shrink then growth to 32 bytes restores a valid index with zeroed lost bytes.
features: [ts-proof-bounds, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects, ts-closures, ts-function-types, ts-arrow-functions]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the call route.
// Shrink then growth to 32 bytes restores a valid index with zeroed lost bytes; node reads -300 - change after the change, otherwise -123456789.
function read(change: number): number {
  const buffer = new ArrayBuffer(24, { maxByteLength: 40 });
  const view = new Int32Array(buffer, 8);
  const index = 2;
  view[index] = -123456789;
  function writer(): () => void {
    return () => {
      if (change > 0) {
        buffer.resize(12);
        buffer.resize(32);
        view[index] += -300 - change;
      }
    };
  }
  const update = writer();
  if (index < view.length) {
    update();
    return view[index];
  }
  return -999;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change > 0 ? -300 - change : -123456789);
}
