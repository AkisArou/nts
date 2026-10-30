/*---
description: A relational comparison invokes valueOf before the established fact is observed.
features: [ts-proof-call-target, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-class-fields, ts-this, ts-conversions, ts-to-primitive, ts-expressions, ts-inheritance, ts-override]
---*/
// Fact: new Base establishes the receiver class (docs/foundations/objects.md, Calls).
// Route: Node observes (change > 0 ? 200 : 100) + change; the operation result is checked separately.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }
function observe(change: number) {
  let target: Base = new Base();
  class Operand {
    active: boolean;
    numeric: number;
    constructor(active: boolean, numeric: number) { this.active = active; this.numeric = numeric; }
    valueOf(): number {
      if (this.active && change > 0) { target = new Next(); }
      return this.numeric;
    }
  }
  const left = new Operand(true, change);
  const right = new Operand(false, 2);
  const compared = left < right;
  return { value: target.run(change), compared };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, (change > 0 ? 200 : 100) + change);
  assert.sameValue(result.compared, change < 2);
}
