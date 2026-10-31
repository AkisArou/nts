/*---
description: Compound assignment invokes a class setter before the proved fact is reused.
features: [ts-proof-call-target, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-accessors, ts-expressions, ts-inheritance, ts-override]
---*/
// Fact: new Base establishes the receiver class (docs/foundations/objects.md, Calls).
// Route: Node observes (change > 0 ? 200 : 100) + change; the operation result is checked separately.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }
function observe(change: number) {
  let target: Base = new Base();
  class Gate {
    get amount(): number { return 10; }
    set amount(next: number) { if (next > 10) { target = new Next(); } }
  }
  const gate = new Gate();
  const assigned = gate.amount += change;
  return { value: target.run(change), assigned };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, (change > 0 ? 200 : 100) + change);
  assert.sameValue(result.assigned, 10 + change);
}
