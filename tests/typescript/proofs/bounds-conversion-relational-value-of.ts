/*---
description: A relational comparison invokes valueOf and removes the element protected by an earlier guard.
features: [ts-proof-bounds, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-class-fields, ts-this, ts-conversions, ts-to-primitive, ts-expressions, ts-null-undefined]
---*/
// Fact: index 3 is below the literal allocation length (docs/foundations/objects.md, Arrays).
// Route: Node observes change > 0 ? undefined : 44; the operation result is checked separately.
function observe(change: number): { value: number | undefined; compared: boolean } {
  const xs = [11, 22, 33, 44];
  const index = 3;
  class Operand {
    active: boolean;
    numeric: number;
    constructor(active: boolean, numeric: number) { this.active = active; this.numeric = numeric; }
    valueOf(): number {
      if (this.active && change > 0) xs.pop();
      return this.numeric;
    }
  }
  const left = new Operand(true, change);
  const right = new Operand(false, 2);
  if (index < xs.length) {
    const compared = left < right;
    return { value: xs[index], compared };
  }
  return { value: -1, compared: false };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? undefined : 44);
  assert.sameValue(result.compared, change < 2);
}
