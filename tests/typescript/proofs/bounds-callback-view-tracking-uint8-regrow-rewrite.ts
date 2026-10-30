/*---
description: Callback effects on a Uint8Array view: shrink then growth to 8 bytes restores a valid index with zeroed lost bytes.
features: [ts-proof-bounds, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects, ts-closures, ts-arrow-functions]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the callback route.
// Shrink then growth to 8 bytes restores a valid index with zeroed lost bytes; node reads 31 + change after the change, otherwise 173.
function read(change: number): number {
  const buffer = new ArrayBuffer(6, { maxByteLength: 10 });
  const view = new Uint8Array(buffer, 2);
  const index = 2;
  view[index] = 173;
  if (index < view.length) {
    Array.from([0, 1], step => {
      if (change > 0) {
        if (step === 0) { buffer.resize(3); }
        else {
          buffer.resize(8);
          view[index] += 31 + change;
        }
      }
      return step;
    });
    return view[index];
  }
  return -999;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change > 0 ? 31 + change : 173);
}
