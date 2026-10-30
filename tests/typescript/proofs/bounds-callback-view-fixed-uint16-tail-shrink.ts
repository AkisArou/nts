/*---
description: Callback effects on a Uint16Array view: shrinking to 9 bytes invalidates the whole fixed view although the indexed bytes survive.
features: [ts-proof-bounds, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects, ts-closures, ts-arrow-functions]
---*/
// docs/foundations/objects.md, Typed arrays: index 1 is guarded before the callback route.
// Shrinking to 9 bytes invalidates the whole fixed view although the indexed bytes survive; node reads undefined after the change, otherwise 50003.
function read(change: number): number | undefined {
  const buffer = new ArrayBuffer(16, { maxByteLength: 20 });
  const view = new Uint16Array(buffer, 4, 3);
  const index = 1;
  view[index] = 50003;
  if (index < view.length) {
    [0, 1].forEach(step => { if (change > 0 && step === 0) { buffer.resize(9); } });
    return view[index];
  }
  return -999;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change > 0 ? undefined : 50003);
}
