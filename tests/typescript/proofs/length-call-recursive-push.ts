/*---
description: Appends while a recursive call unwinds invalidate the caller's exact allocation length.
features: [ts-proof-length, ts-route-call, ts-arrays, ts-functions, ts-iteration]
---*/
// Fact: the literal has length 2 (docs/foundations/objects.md, Arrays).
// Route: recursive calls append on return; node reads 2 + depth, including depth 0.
function appendOnReturn(xs: number[], depth: number): void {
  if (depth === 0) return;
  appendOnReturn(xs, depth - 1);
  xs.push(depth);
}

function lengthAfterRecursion(depth: number): number {
  const xs = [10, 20];
  appendOnReturn(xs, depth);
  return xs.length;
}

for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterRecursion(n), n + 2);
}
