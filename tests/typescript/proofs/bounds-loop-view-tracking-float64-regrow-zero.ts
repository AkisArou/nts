/*---
description: Loop effects on a Float64Array view: shrink then growth to 64 bytes restores a valid index with zeroed lost bytes.
features: [ts-proof-bounds, ts-route-loop, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-objects]
---*/
// docs/foundations/objects.md, Typed arrays: index 2 is guarded before the loop route.
// Shrink then growth to 64 bytes restores a valid index with zeroed lost bytes; node reads 0 after the change, otherwise -12.5.
function read(change: number): number {
  const buffer = new ArrayBuffer(48, { maxByteLength: 80 });
  const view = new Float64Array(buffer, 16);
  const index = 2;
  view[index] = -12.5;
  if (index < view.length) {
    let observed: number = -12.5;
    for (let turn = 0; turn < change; turn++) {
      if (turn === 0) {
        buffer.resize(24);
        buffer.resize(64);
        continue;
      }
      observed = view[index];
    }
    return observed;
  }
  return -999;
}
for (const change of [0, 1, 2, 3, 7]) {
  const result = read(change);
  assert.sameValue(result, change >= 2 ? 0 : -12.5);
}
