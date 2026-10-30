/*---
description: The taken logical-or operand shortens an otherwise unchanged allocation.
features: [ts-proof-length, ts-route-merge, ts-functions, ts-iteration, ts-arrays, ts-expressions]
---*/
// Fact: the literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: || joins a skipped shift with an executed one; node reads 4 or 3.
function lengthAfterOr(n: number): number {
  const xs = [10, 20, 30, 40];
  n > 0 || xs.shift();
  return xs.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthAfterOr(n), n > 0 ? 4 : 3);
}
