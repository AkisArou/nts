/*---
description: A catch edge joins a normal whole result with NaN.
features: [ts-proof-whole-number, ts-route-merge, ts-functions, ts-iteration, ts-numbers, ts-errors]
---*/
// Fact: the initial binding is a whole integer in range (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the catch assigns NaN before joining; node preserves NaN.
function afterJoin(n: number): number {
  let value = 1;
  try {
    if (n > 0) throw new Error("join");
    value = 2;
  } catch {
    value = NaN;
  }
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), n > 0 ? NaN : 2);
}
