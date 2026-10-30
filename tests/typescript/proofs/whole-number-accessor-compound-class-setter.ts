/*---
description: Compound assignment invokes a class setter before the proved fact is reused.
features: [ts-proof-whole-number, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-accessors, ts-expressions, ts-numbers]
---*/
// Fact: the literal value is a whole number in range (docs/foundations/numbers.md, Integers proved from doubles).
// Route: Node observes change > 0 ? 2147483648 : 2147483647; the operation result is checked separately.
function observe(change: number) {
  let value = 2147483647;
  class Gate {
    get amount(): number { return 10; }
    set amount(next: number) { if (next > 10) { value = 2147483648; } }
  }
  const gate = new Gate();
  const assigned = gate.amount += change;
  return { value: value, assigned };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? 2147483648 : 2147483647);
  assert.sameValue(result.assigned, 10 + change);
}
