/*---
description: A relational comparison invokes valueOf before the established fact is observed.
features: [ts-proof-element-kind, ts-route-conversion, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-closures, ts-class, ts-class-fields, ts-this, ts-conversions, ts-to-primitive, ts-expressions, ts-numbers]
---*/
// Fact: number[] starts with only integer elements (docs/foundations/objects.md, Arrays).
// Route: Node observes change > 0 ? 1.5 : 3; the operation result is checked separately.
function read(xs: number[]): number { return xs[1]; }
function observe(change: number) {
  const xs = [1, 3, 5];
  class Operand {
    active: boolean;
    numeric: number;
    constructor(active: boolean, numeric: number) { this.active = active; this.numeric = numeric; }
    valueOf(): number {
      if (this.active && change > 0) { xs[1] /= 2; }
      return this.numeric;
    }
  }
  const left = new Operand(true, change);
  const right = new Operand(false, 2);
  const compared = left < right;
  return { value: read(xs), compared };
}
for (const change of [-1, 0, 1, 3, 7]) {
  const result = observe(change);
  assert.sameValue(result.value, change > 0 ? 1.5 : 3);
  assert.sameValue(result.compared, change < 2);
}
