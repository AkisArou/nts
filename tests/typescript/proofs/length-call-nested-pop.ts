/*---
description: A pop reached through a nested call invalidates a mapped array's known length.
features: [ts-proof-length, ts-route-call, ts-arrays, ts-arrow-functions, ts-closures, ts-functions, ts-iteration]
---*/
// Fact: map preserves its source's length 4 (docs/foundations/objects.md, Arrays).
// Route: an outer call reaches an inner pop; node reads 3, or 4 without a pop.
function lengthAfterNestedCall(n: number): number {
  const source = [10, 20, 30, 40];
  const xs = source.map(value => value + 1);
  function inner(): void {
    if (n > 0) xs.pop();
  }
  function outer(): void {
    inner();
  }
  outer();
  return xs.length;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthAfterNestedCall(n), n > 0 ? 3 : 4);
}
