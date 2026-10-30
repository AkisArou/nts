/*---
description: Compound assignment invokes a class setter before the proved fact is reused.
features: [ts-proof-capture, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-accessors, ts-expressions, ts-arrow-functions, ts-function-types]
---*/
// Fact: the reader is created before any write to its binding (docs/foundations/objects.md, Functions as values).
// Route: Node observes change > 0 ? 10 + change : 10; the operation result is checked separately.
function observe(change: number) {
  let value = 10;
  const read = (): number => value;
  class Gate {
    get amount(): number { return 10; }
    set amount(next: number) { if (next > 10) { value = next; } }
  }
  const gate = new Gate();
  const assigned = gate.amount += change;
  return { value: read(), assigned };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? 10 + change : 10);
  assert.sameValue(result.assigned, 10 + change);
}
