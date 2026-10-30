/*---
description: A catch edge can contribute negative zero to a numeric join.
features: [ts-proof-negative-zero, ts-route-merge, ts-functions, ts-iteration, ts-numbers, ts-errors]
---*/
// Fact: the binding initially holds positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the catch edge assigns -0 before joining; node retains that sign.
function afterJoin(n: number): number {
  let value = 0;
  try {
    if (n > 0) throw new Error("join");
  } catch {
    value = -0;
  }
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), n > 0 ? -0 : 0);
}
