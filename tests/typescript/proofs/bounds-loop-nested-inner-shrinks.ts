/*---
description: A shrink in an inner loop invalidates the allocation bound on later inner and outer iterations.
features: [ts-proof-bounds, ts-route-loop, ts-arrays, ts-functions, ts-iteration, ts-null-undefined]
---*/
// docs/foundations/objects.md, Arrays: index 3 starts inside a literal's length.
// The inner loop shrinks it on the first outer pass; later reads give undefined.
function readAfterNestedTurns(turns: number): number | undefined {
  const xs = [11, 22, 33, 44];
  let result: number | undefined = 44;
  for (let outer = 0; outer < 2; outer++) {
    for (let inner = 0; inner < turns; inner++) {
      result = xs[3];
      if (outer === 0) xs.length = 3;
    }
  }
  return result;
}

for (const turns of [0, 1, 2, 3, 7]) {
  assert.sameValue(readAfterNestedTurns(turns), turns === 0 ? 44 : undefined);
}
