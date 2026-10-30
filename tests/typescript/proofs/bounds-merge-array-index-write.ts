/*---
description: The joined index may be 4; writing there appends and makes length 5.
features: [ts-proof-bounds, ts-route-merge, ts-functions, ts-iteration, ts-arrays]
---*/
// docs/foundations/objects.md, Arrays: index 0 is in range before the branch introduces index 4.
// The joined index may be 4; writing there appends and makes length 5.
function write(mode: number): number {
  const xs = [11, 22, 33, 44];
  let index = 0;
  if (mode > 0) index = 4;
  xs[index] = 70 + mode;
  return xs.length * 100 + xs[index];
}
for (const mode of [-1, 0, 1, 4]) assert.sameValue(write(mode), (mode > 0 ? 570 : 470) + mode);
