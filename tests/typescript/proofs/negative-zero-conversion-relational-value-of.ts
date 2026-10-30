/*---
description: A relational comparison invokes valueOf before the established fact is observed.
features: [ts-proof-negative-zero, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-class-fields, ts-this, ts-conversions, ts-to-primitive, ts-expressions, ts-numbers]
---*/
// Fact: the literal value is positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: Node observes change > 0 ? -0 : 0; the operation result is checked separately.
function observe(change: number) {
  let value = 0;
  class Operand {
    active: boolean;
    numeric: number;
    constructor(active: boolean, numeric: number) { this.active = active; this.numeric = numeric; }
    valueOf(): number {
      if (this.active && change > 0) { value = -0; }
      return this.numeric;
    }
  }
  const left = new Operand(true, change);
  const right = new Operand(false, 2);
  const compared = left < right;
  return { value: value, compared };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? -0 : 0);
  assert.sameValue(result.compared, change < 2);
}
