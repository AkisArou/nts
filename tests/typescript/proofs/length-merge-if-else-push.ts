/*---
description: Joining an append with an element overwrite does not retain the allocation's exact length.
features: [ts-proof-length, ts-route-merge, ts-arrays, ts-functions, ts-iteration]
---*/
// Fact: the literal has length 2 (docs/foundations/objects.md, Arrays).
// Route: an append and an overwrite join; node reads 3 or the unchanged 2.
function lengthAtJoin(n: number): number {
  const xs = [10, 20];
  if (n > 0) {
    xs.push(n);
  } else {
    xs[0] = n;
  }
  return xs.length;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthAtJoin(n), n > 0 ? 3 : 2);
}
