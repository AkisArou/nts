/*---
description: A closure append invalidates the length of its captured empty allocation.
features: [ts-proof-length, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-closures]
---*/
// Fact: the literal has length 0 (docs/foundations/objects.md, Arrays).
// Route: a called closure appends; node reads 1, or unchanged 0.
function lengthAfterClosure(n: number): number {
  const xs: number[] = [];
  function append(): void {
    if (n > 0) xs.push(n);
  }
  append();
  return xs.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthAfterClosure(n), n > 0 ? 1 : 0);
}
