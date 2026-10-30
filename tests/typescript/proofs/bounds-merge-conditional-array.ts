/*---
description: A conditional replacement with a shorter array invalidates the original allocation's bound.
features: [ts-proof-bounds, ts-route-merge, ts-arrays, ts-functions, ts-iteration, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 is below the initial length 4.
// The conditional joins that array with a length-1 array; node gives undefined.
function readAfterChoice(n: number): number | undefined {
  let xs = [10, 20, 30, 40];
  xs = n > 0 ? [50] : xs;
  return xs[3];
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(readAfterChoice(n), n > 0 ? undefined : 40);
}
