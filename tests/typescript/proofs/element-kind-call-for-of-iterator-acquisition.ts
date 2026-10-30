/*---
description: For-of invokes a user iterator method that changes the previously proved fact.
features: [ts-proof-element-kind, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-symbols, ts-computed-keys, ts-numbers]
---*/
// Fact: number[] starts with only integer elements (docs/foundations/objects.md, Arrays).
// Route: Node observes change > 0 ? 2.5 : 2; the operation result is checked separately.
function read(xs: number[]): number { return xs[1]; }
function observe(change: number) {
  const xs = [1, 2, 3];
  class Steps implements Iterable<number> {
    [Symbol.iterator](): Iterator<number> {
      if (change > 0) { xs[1] += 0.5; }
      return [7][Symbol.iterator]();
    }
  }
  let total = 0;
  for (const item of new Steps()) total += item;
  return { value: read(xs), total };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? 2.5 : 2);
  assert.sameValue(result.total, 7);
}
