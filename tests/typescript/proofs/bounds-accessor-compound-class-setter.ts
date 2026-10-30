/*---
description: A compound-assignment setter shrinks a guarded array before its indexed read.
features: [ts-proof-bounds, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-accessors, ts-expressions, ts-null-undefined]
---*/
// Fact: index 3 is below the literal allocation length (docs/foundations/objects.md, Arrays).
// Route: Node observes change > 0 ? undefined : 44; the operation result is checked separately.
function observe(change: number): { value: number | undefined; assigned: number } {
  const xs = [11, 22, 33, 44];
  const index = 3;
  class Gate {
    get amount(): number { return 10; }
    set amount(next: number) { if (next > 10) xs.length = 3; }
  }
  const gate = new Gate();
  if (index < xs.length) {
    const assigned = gate.amount += change;
    return { value: xs[index], assigned };
  }
  return { value: -1, assigned: -1 };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? undefined : 44);
  assert.sameValue(result.assigned, 10 + change);
}
