/*---
description: Callback effects on an Int32Array view: transfer rebinds the view to the copied destination before its valid element is updated.
features: [ts-proof-bounds, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects, ts-closures, ts-arrow-functions, ts-map-set]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the callback route.
// Transfer rebinds the view to the copied destination before its valid element is updated; node reads -123456789 + (-7 - change) after the change, otherwise -123456789.
function read(change: number): number {
  const buffer = new ArrayBuffer(24, { maxByteLength: 40 });
  let view = new Int32Array(buffer, 4, 3);
  const index = 2;
  view[index] = -123456789;
  if (index < view.length) {
    new Set([0, 1]).forEach(step => {
      if (change > 0 && step === 1) {
        const moved = buffer.transfer(20);
        view = new Int32Array(moved, 4, 3);
        view[index] += -7 - change;
      }
    });
    return view[index];
  }
  return -999;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change > 0 ? -123456789 + (-7 - change) : -123456789);
}
