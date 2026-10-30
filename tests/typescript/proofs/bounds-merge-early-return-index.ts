/*---
description: The surviving path reaches index 4 and reads undefined.
features: [ts-proof-bounds, ts-route-merge, ts-functions, ts-iteration, ts-arrays, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 0 starts within the literal array.
// The surviving path reaches index 4 and reads undefined.
function read(mode: number): number | undefined {
  const xs = [11, 22, 33, 44];
  let index = 0;
  if (mode < 0) return xs[index];
  if (mode > 0) index = 4;
  return xs[index];
}
for (const mode of [-3, -1, 0, 1, 4]) assert.sameValue(read(mode), mode > 0 ? undefined : 11);
