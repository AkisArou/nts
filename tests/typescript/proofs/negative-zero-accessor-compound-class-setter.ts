/*---
description: Compound assignment invokes a class setter before the proved fact is reused.
features: [ts-proof-negative-zero, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-accessors, ts-expressions, ts-numbers]
---*/
// Fact: the literal value is positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: Node observes change > 0 ? -0 : 0; the operation result is checked separately.
function observe(change: number) {
  let value = 0;
  class Gate {
    get amount(): number { return 10; }
    set amount(next: number) { if (next > 10) { value = -0; } }
  }
  const gate = new Gate();
  const assigned = gate.amount += change;
  return { value: value, assigned };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? -0 : 0);
  assert.sameValue(result.assigned, 10 + change);
}
