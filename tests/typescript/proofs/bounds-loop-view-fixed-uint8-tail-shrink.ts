/*---
description: Loop effects on a Uint8Array view: shrinking to 4 bytes invalidates the whole fixed view although the indexed bytes survive.
features: [ts-proof-bounds, ts-route-loop, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined, ts-objects]
---*/
// docs/foundations/objects.md, Typed arrays: index 1 is guarded before the loop route.
// Shrinking to 4 bytes invalidates the whole fixed view although the indexed bytes survive; node reads undefined after the change, otherwise 173.
function read(change: number): number | undefined {
  const buffer = new ArrayBuffer(8, { maxByteLength: 10 });
  const view = new Uint8Array(buffer, 2, 3);
  const index = 1;
  view[index] = 173;
  if (index < view.length) {
    let observed: number | undefined = 173;
    for (let turn = 0; turn < change; turn++) {
      observed = view[index];
      if (turn === 0) { buffer.resize(4); }
    }
    return observed;
  }
  return -999;
}
for (const change of [0, 1, 2, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change >= 2 ? undefined : 173);
}
