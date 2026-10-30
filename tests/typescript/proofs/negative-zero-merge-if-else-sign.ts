/*---
description: A branch join preserves the sign of its negative-zero arm.
features: [ts-proof-negative-zero, ts-route-merge, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the binding initially holds positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the two branches join +0 and -0; node retains the selected sign.
function afterJoin(n: number): number {
  let value = 0;
  if (n > 0) value = -0;
  else value = 0;
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), n > 0 ? -0 : 0);
}
