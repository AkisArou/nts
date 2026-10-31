/*---
description: For-of resumes a generator that shifts an array while the guarded index remains valid.
features: [ts-proof-bounds, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-symbols, ts-computed-keys, ts-generators]
---*/
// Fact: index 1 stays below the length after one shift (docs/foundations/objects.md, Arrays).
// Route: Node observes change > 0 ? 33 : 22; the operation result is checked separately.
function observe(change: number) {
  const xs = [11, 22, 33, 44];
  const index = 1;
  class Steps implements Iterable<number> {
    *[Symbol.iterator](): Generator<number, void, void> {
      if (change > 0) xs.shift();
      yield 7;
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
  assert.sameValue(result.value, change > 0 ? 33 : 22);
  assert.sameValue(result.total, 7);
}
