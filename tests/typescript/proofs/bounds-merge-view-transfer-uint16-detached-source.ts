/*---
description: Merge effects on a Uint16Array view: transfer detaches the original view while the guarded old index is retained.
features: [ts-proof-bounds, ts-route-merge, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the merge route.
// Transfer detaches the original view while the guarded old index is retained; node reads undefined after the change, otherwise 50003.
function read(change: number): number | undefined {
  const buffer = new ArrayBuffer(12, { maxByteLength: 20 });
  const view = new Uint16Array(buffer, 2, 3);
  const index = 2;
  view[index] = 50003;
  if (index < view.length) {
    switch (change > 0) {
      case true: buffer.transferToFixedLength(10); break;
      default: break;
    }
    return view[index];
  }
  return -999;
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change > 0 ? undefined : 50003);
}
