/*---
description: Loop effects on a Uint8Array view: transfer detaches the original view while the guarded old index is retained.
features: [ts-proof-bounds, ts-route-loop, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the loop route.
// Transfer detaches the original view while the guarded old index is retained; node reads undefined after the change, otherwise 173.
function read(change: number): number | undefined {
  const buffer = new ArrayBuffer(6, { maxByteLength: 10 });
  const view = new Uint8Array(buffer, 1, 3);
  const index = 2;
  view[index] = 173;
  if (index < view.length) {
    let observed: number | undefined = 173;
    let turn = 0;
    while (turn < change) {
      observed = view[index];
      if (turn === 0) { buffer.transfer(8); }
      turn++;
    }
    return observed;
  }
  return -999;
}
for (const change of [0, 1, 2, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change >= 2 ? undefined : 173);
}
