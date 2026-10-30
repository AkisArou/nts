/*---
description: A mandatory pop makes index 3 append; the write restores length 4.
features: [ts-proof-bounds, ts-route-loop, ts-functions, ts-iteration, ts-arrays]
---*/
// docs/foundations/objects.md, Arrays: index 3 initially lies inside length 4.
// A mandatory pop makes index 3 append; the write restores length 4.
function write(turns: number): number {
  const xs = [11, 22, 33, 44];
  const index = 3;
  let turn = 0;
  do {
    xs.pop();
    turn++;
    xs[index] = 70 + turn;
  } while (turn < turns);
  return xs.length * 100 + xs[index];
}
for (const turns of [0, 1, 2, 4, 7]) {
  assert.sameValue(write(turns), 470 + (turns < 1 ? 1 : turns));
}
