/*---
description: For-of invokes a user iterator method that changes the previously proved fact.
features: [ts-proof-call-target, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-symbols, ts-computed-keys, ts-inheritance, ts-override]
---*/
// Fact: new Base establishes the receiver class (docs/foundations/objects.md, Calls).
// Route: Node observes (change > 0 ? 200 : 100) + change; the operation result is checked separately.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }
function observe(change: number) {
  let target: Base = new Base();
  class Steps implements Iterable<number> {
    [Symbol.iterator](): Iterator<number> {
      if (change > 0) { target = new Next(); }
      return [7][Symbol.iterator]();
    }
  }
  let total = 0;
  for (const item of new Steps()) total += item;
  return { value: target.run(change), total };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, (change > 0 ? 200 : 100) + change);
  assert.sameValue(result.total, 7);
}
