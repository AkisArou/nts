/*---
description: Compound assignment invokes a class setter before the proved fact is reused.
features: [ts-proof-length, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-accessors, ts-expressions]
---*/
// Fact: the literal allocation has length 3 (docs/foundations/objects.md, Arrays).
// Route: Node observes change > 0 ? 4 : 3; the operation result is checked separately.
function observe(change: number) {
  const xs = [1, 2, 3];
  class Gate {
    get amount(): number { return 10; }
    set amount(next: number) { if (next > 10) { xs.push(4); } }
  }
  const gate = new Gate();
  const assigned = gate.amount += change;
  return { value: xs.length, assigned };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? 4 : 3);
  assert.sameValue(result.assigned, 10 + change);
}
