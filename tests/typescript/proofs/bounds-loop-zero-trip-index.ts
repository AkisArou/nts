/*---
description: Zero trips retain index 0; four updates give undefined at index 4.
features: [ts-proof-bounds, ts-route-loop, ts-functions, ts-iteration, ts-arrays, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 0 starts below the literal length 4.
// Zero trips retain index 0; four updates give undefined at index 4.
function read(turns: number): number | undefined {
  const xs = [11, 22, 33, 44];
  let index = 0;
  for (let turn = 0; turn < turns; turn++) index++;
  return xs[index];
}
for (const turns of [-1, 0, 1, 3, 4, 7]) {
  assert.sameValue(read(turns), turns <= 0 ? 11 : turns === 1 ? 22 : turns === 3 ? 44 : undefined);
}
