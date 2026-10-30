/*---
description: Sign-sensitive extrema retain the zero sign selected at a branch join.
features: [ts-proof-negative-zero, ts-route-merge, ts-functions, ts-iteration, ts-numbers, ts-objects]
---*/
// Fact: the entry value is positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: one branch supplies -0; node preserves it through min and max with opposite zero bounds.
function extremaAtJoin(n: number): { minimum: number; maximum: number } {
  let value = 0;
  if (n > 0) value = -0;
  return { minimum: Math.min(value, 0), maximum: Math.max(value, -0) };
}

for (const n of [-1, 0, 1, 3, 7]) {
  const seen = extremaAtJoin(n);
  assert.sameValue(seen.minimum, n > 0 ? -0 : 0);
  assert.sameValue(seen.maximum, n > 0 ? -0 : 0);
}
