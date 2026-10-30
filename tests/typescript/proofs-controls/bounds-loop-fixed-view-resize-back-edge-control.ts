/*---
description: Control for bounds-loop-fixed-view-resize-back-edge; the invalidating route is removed.
features: [ts-proof-bounds, ts-route-loop, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-null-undefined]
---*/
// Paired subject: ../proofs/bounds-loop-fixed-view-resize-back-edge.ts.
// Only the invalidating route is removed; assertions observe the unchanged fact.
function read(turns: number): number | undefined {
  const buffer = new ArrayBuffer(8, { maxByteLength: 8 });
  const view = new Int32Array(buffer, 0, 2);
  view[0] = 17;
  let result: number | undefined = 17;
  for (let turn = 0; turn < turns; turn++) {
    result = view[0];
    buffer.resize(8);
  }
  return result;
}
for (const turns of [0, 1, 2, 3, 7]) assert.sameValue(read(turns), 17);
