/*---
description: A called closure invalidates the whole-number fact for its captured binding.
features: [ts-proof-whole-number, ts-route-call, ts-functions, ts-iteration, ts-numbers, ts-closures]
---*/
// Fact: the captured binding begins with whole one (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the closure writes a fraction before the caller reads; node gives 0.25.
function afterClosure(n: number): number {
  let value = 1;
  function write(): void {
    if (n > 0) value = 0.25;
  }
  write();
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterClosure(n), n > 0 ? 0.25 : 1);
}
