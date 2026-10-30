/*---
description: The finally edge carries index 4 into a post-try read.
features: [ts-proof-bounds, ts-route-merge, ts-functions, ts-iteration, ts-arrays, ts-errors, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 0 is initially within the literal length 4.
// The finally edge carries index 4 into a post-try read.
function read(mode: number): number | undefined {
  const xs = [11, 22, 33, 44];
  let index = 0;
  try { if (mode < 0) index = 1; }
  finally { if (mode > 0) index = 4; }
  return xs[index];
}
for (const mode of [-2, -1, 0, 1, 3]) {
  assert.sameValue(read(mode), mode > 0 ? undefined : mode < 0 ? 22 : 11);
}
