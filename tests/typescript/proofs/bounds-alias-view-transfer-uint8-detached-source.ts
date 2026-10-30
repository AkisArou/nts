/*---
description: Alias effects on a Uint8Array view: transfer detaches the original view while the guarded old index is retained.
features: [ts-proof-bounds, ts-route-alias, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects, ts-closures, ts-arrow-functions]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the alias route.
// Transfer detaches the original view while the guarded old index is retained; node reads undefined after the change, otherwise 173.
function read(change: number): number | undefined {
  const buffer = new ArrayBuffer(6, { maxByteLength: 10 });
  const view = new Uint8Array(buffer, 1, 3);
  const index = 2;
  view[index] = 173;
  const locate = (): ArrayBuffer => buffer;
  const alias = locate();
  if (index < view.length) {
    if (change > 0) {
      alias.transfer(8);
    }
    return view[index];
  }
  return -999;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change > 0 ? undefined : 173);
}
