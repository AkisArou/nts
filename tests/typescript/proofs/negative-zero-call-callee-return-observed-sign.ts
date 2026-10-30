/*---
description: A callee return keeps the zero sign needed by division in its caller.
features: [ts-proof-negative-zero, ts-route-call, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the callee binding begins with positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the callee later returns -0; node gives -Infinity when the caller divides by it.
function supply(n: number): number {
  let value = 0;
  if (n > 0) value = -0;
  return value;
}

function reciprocal(n: number): number {
  return 1 / supply(n);
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(reciprocal(n), n > 0 ? -Infinity : Infinity);
}
