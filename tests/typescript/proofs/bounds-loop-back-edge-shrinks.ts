/*---
description: An allocation's in-bounds index is checked again after the loop back edge carries a shorter array.
features: [ts-proof-bounds, ts-route-loop, ts-arrays, ts-functions, ts-iteration, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: literal index 3 is below length 4.
// A shrink reaches the next read through the back edge; node gives undefined.
function readAfterTurns(turns: number): number | undefined {
  const xs = [11, 22, 33, 44];
  let result: number | undefined = 44;
  for (let turn = 0; turn < turns; turn++) {
    result = xs[3];
    xs.length = 3;
  }
  return result;
}

for (const turns of [0, 1, 2, 3, 7]) {
  assert.sameValue(readAfterTurns(turns), turns < 2 ? 44 : undefined);
}
