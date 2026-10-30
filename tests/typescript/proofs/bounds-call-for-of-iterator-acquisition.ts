/*---
description: Obtaining a for-of iterator shrinks an array after its index was guarded.
features: [ts-proof-bounds, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-symbols, ts-computed-keys, ts-null-undefined]
---*/
// Fact: index 3 is below the literal allocation length (docs/foundations/objects.md, Arrays).
// Route: Node observes change > 0 ? undefined : 44; the operation result is checked separately.
function observe(change: number): { value: number | undefined; total: number } {
  const xs = [11, 22, 33, 44];
  const index = 3;
  class Steps implements Iterable<number> {
    [Symbol.iterator](): Iterator<number> {
      if (change > 0) xs.length = 3;
      return [7][Symbol.iterator]();
    }
  }
  if (index < xs.length) {
    let total = 0;
    for (const item of new Steps()) total += item;
    return { value: xs[index], total };
  }
  return { value: -1, total: -1 };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? undefined : 44);
  assert.sameValue(result.total, 7);
}
