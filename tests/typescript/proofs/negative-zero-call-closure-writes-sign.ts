/*---
description: A called closure can invalidate the positive-zero fact of a captured binding.
features: [ts-proof-negative-zero, ts-route-call, ts-functions, ts-iteration, ts-numbers, ts-closures]
---*/
// Fact: the captured binding begins with positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the closure writes -0 before the caller reads; node distinguishes its sign.
function afterClosure(n: number): number {
  let value = 0;
  function write(): void {
    if (n > 0) value = -0;
  }
  write();
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterClosure(n), n > 0 ? -0 : 0);
}
