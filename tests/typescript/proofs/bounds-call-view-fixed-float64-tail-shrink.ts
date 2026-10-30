/*---
description: Call effects on a Float64Array view: shrinking to 39 bytes invalidates the whole fixed view although the indexed bytes survive.
features: [ts-proof-bounds, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects, ts-closures]
---*/
// docs/foundations/objects.md, Typed arrays: index 1 is guarded before the call route.
// Shrinking to 39 bytes invalidates the whole fixed view although the indexed bytes survive; node reads undefined after the change, otherwise -12.5.
function read(change: number): number | undefined {
  const buffer = new ArrayBuffer(64, { maxByteLength: 80 });
  const view = new Float64Array(buffer, 16, 3);
  const index = 1;
  view[index] = -12.5;
  function update(): void {
    if (change > 0) {
      buffer.resize(39);
    }
  }
  if (index < view.length) {
    update();
    return view[index];
  }
  return -999;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change > 0 ? undefined : -12.5);
}
