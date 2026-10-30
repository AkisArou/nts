/*---
description: A recursive base can return negative zero through each outer return.
features: [ts-proof-negative-zero, ts-route-call, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the base binding begins with positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the selected base update produces -0; node preserves it through recursive return summaries.
function descend(depth: number, negative: boolean): number {
  let value = 0;
  if (depth === 0) {
    if (negative) value = -0;
    return value;
  }
  return descend(depth - 1, negative);
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(descend(n, false), 0);
  assert.sameValue(descend(n, true), -0);
}
