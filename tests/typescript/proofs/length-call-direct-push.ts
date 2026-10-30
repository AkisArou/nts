/*---
description: A direct callee's append invalidates the length supplied to an array allocation.
features: [ts-proof-length, ts-route-call, ts-arrays, ts-functions, ts-iteration]
---*/
// Fact: new Array(n) has length n (docs/foundations/objects.md, Arrays).
// Route: a direct call appends for positive n; node reads n + 1, or 0 at n = 0.
function appendIfPositive(xs: number[], n: number): void {
  if (n > 0) xs.push(n);
}

function lengthAfterCall(n: number): number {
  const xs = new Array<number>(n);
  appendIfPositive(xs, n);
  return xs.length;
}

for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterCall(n), n === 0 ? 0 : n + 1);
}
