/*---
description: For-of invokes a user iterator method that changes the previously proved fact.
features: [ts-proof-negative-zero, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-symbols, ts-computed-keys, ts-generators, ts-numbers]
---*/
// Fact: the literal value is positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: Node observes change > 0 ? -0 : 0; the operation result is checked separately.
function observe(change: number) {
  let value = 0;
  class Steps implements Iterable<number> {
    *[Symbol.iterator](): Generator<number, void, void> {
      if (change > 0) { value = -0; }
      yield 7;
    }
  }
  let total = 0;
  for (const item of new Steps()) total += item;
  return { value: value, total };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? -0 : 0);
  assert.sameValue(result.total, 7);
}
