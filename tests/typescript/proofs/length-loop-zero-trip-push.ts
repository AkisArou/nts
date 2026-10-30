/*---
description: The zero-trip path retains the allocation length while loop updates grow it.
features: [ts-proof-length, ts-route-loop, ts-functions, ts-iteration, ts-arrays]
---*/
// Fact: the literal has length 3 (docs/foundations/objects.md, Arrays).
// Route: zero or several back edges reach the exit; node reads 3 + turns.
function lengthAfterMaybeLoop(turns: number): number {
  const xs = [10, 20, 30];
  for (let i = 0; i < turns; i++) xs.push(i);
  return xs.length;
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterMaybeLoop(n), 3 + n);
}
