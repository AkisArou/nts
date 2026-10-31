/*---
description: For-of invokes a user iterator method that changes the previously proved fact.
features: [ts-proof-length, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-symbols, ts-computed-keys, ts-generators]
---*/
// Fact: the literal allocation has length 3 (docs/foundations/objects.md, Arrays).
// Route: Node observes change > 0 ? 4 : 3; the operation result is checked separately.
function observe(change: number) {
  const xs = [1, 2, 3];
  class Steps implements Iterable<number> {
    *[Symbol.iterator](): Generator<number, void, void> {
      if (change > 0) { xs.push(4); }
      yield 7;
    }
  }
  let total = 0;
  for (const item of new Steps()) total += item;
  return { value: xs.length, total };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? 4 : 3);
  assert.sameValue(result.total, 7);
}
