/*---
description: Callback effects on a Float64Array view: the offset tracking view loses index 2 when its buffer shrinks to 31 bytes.
features: [ts-proof-bounds, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects, ts-closures, ts-arrow-functions]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the callback route.
// The offset tracking view loses index 2 when its buffer shrinks to 31 bytes; node reads undefined after the change, otherwise -12.5.
function read(change: number): number | undefined {
  const buffer = new ArrayBuffer(48, { maxByteLength: 80 });
  const view = new Float64Array(buffer, 16);
  const index = 2;
  view[index] = -12.5;
  if (index < view.length) {
    [1, 0, 2].forEach(step => { if (change > 0 && step === 0) { buffer.resize(31); } });
    return view[index];
  }
  return -999;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change > 0 ? undefined : -12.5);
}
