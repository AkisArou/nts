/*---
description: Alias effects on a Uint8Array view: shrinking to 4 bytes invalidates the whole fixed view although the indexed bytes survive.
features: [ts-proof-bounds, ts-route-alias, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects]
---*/
// docs/foundations/objects.md, Typed arrays: index 1 is guarded before the alias route.
// Shrinking to 4 bytes invalidates the whole fixed view although the indexed bytes survive; node reads undefined after the change, otherwise 173.
function read(change: number): number | undefined {
  const buffer = new ArrayBuffer(8, { maxByteLength: 10 });
  const view = new Uint8Array(buffer, 2, 3);
  const index = 1;
  view[index] = 173;
  const alias = view.buffer;
  if (index < view.length) {
    if (change > 0) {
      alias.resize(4);
    }
    return view[index];
  }
  return -999;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change > 0 ? undefined : 173);
}
