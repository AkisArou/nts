/*---
description: For-of invokes a user iterator method that changes the previously proved fact.
features: [ts-proof-capture, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-symbols, ts-computed-keys, ts-generators, ts-arrow-functions, ts-function-types]
---*/
// Fact: the reader is created before any write to its binding (docs/foundations/objects.md, Functions as values).
// Route: Node observes change > 0 ? 10 + change : 10; the operation result is checked separately.
function observe(change: number) {
  let value = 10;
  const read = (): number => value;
  class Steps implements Iterable<number> {
    *[Symbol.iterator](): Generator<number, void, void> {
      if (change > 0) { value = 10 + change; }
      yield 7;
    }
  }
  let total = 0;
  for (const item of new Steps()) total += item;
  return { value: read(), total };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? 10 + change : 10);
  assert.sameValue(result.total, 7);
}
