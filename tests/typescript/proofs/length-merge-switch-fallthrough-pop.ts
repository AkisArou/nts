/*---
description: A fall-through switch carries one or two pops into the joined length read.
features: [ts-proof-length, ts-route-merge, ts-functions, ts-iteration, ts-arrays]
---*/
// Fact: the literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: switch fall-through can pop twice; node reads 2, 3, or unchanged 4.
function lengthAfterSwitch(n: number): number {
  const xs = [10, 20, 30, 40];
  switch (n) {
    case 1:
      xs.pop();
    case 2:
      xs.pop();
      break;
    default:
      break;
  }
  return xs.length;
}
for (const n of [0, 1, 2, 3, 7, -1]) {
  assert.sameValue(lengthAfterSwitch(n), n === 1 ? 2 : n === 2 ? 3 : 4);
}
