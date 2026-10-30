/*---
description: A recursive call can replace an initially whole parameter with a fraction.
features: [ts-proof-whole-number, ts-route-call, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: every outer call supplies the whole literal seven (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the final recursive call introduces 3.5; node preserves it through the returns.
function descend(depth: number, value: number): number {
  if (depth === 0) return value;
  return descend(depth - 1, depth === 1 ? 3.5 : value);
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(descend(n, 7), n === 0 ? 7 : 3.5);
}
