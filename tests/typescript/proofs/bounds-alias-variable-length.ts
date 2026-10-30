/*---
description: Assigning length through a second variable invalidates the original array's guarded index.
features: [ts-proof-bounds, ts-route-alias, ts-arrays, ts-functions, ts-iteration, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 is guarded by the literal's length.
// Its alias assigns a smaller length; node's read through the first name is undefined.
function readAfterAlias(keep: number): number | undefined {
  const xs = [10, 20, 30, 40];
  const alias = xs;
  const i = 3;
  if (i < xs.length) {
    alias.length = keep;
    return xs[i];
  }
  return -1;
}

for (const keep of [0, 1, 2, 3, 4]) {
  assert.sameValue(readAfterAlias(keep), keep === 4 ? 40 : undefined);
}
