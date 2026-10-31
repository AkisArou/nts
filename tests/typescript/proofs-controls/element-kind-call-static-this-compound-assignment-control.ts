/*---
description: Control. Use only Base.delta at the same compound-assignment call site.
features: [ts-proof-element-kind, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-numbers, ts-arrays]
---*/
// Control: paired with proofs/element-kind-call-static-this-compound-assignment.ts. Use only Base.delta at the same compound-assignment call site.
// Fact: integer-only array stores permit integer elements (docs/foundations/objects.md, Arrays).
// Route: this.delta supplies the array store; node keeps the fractional element when a separate function reads it.
function read(xs: number[]): number { return xs[1]; }
class Base {
  static divisor: number = 1;
  static delta(n: number): number { return 0; }
  static run(n: number): number {
    const xs = [1, 2, 3];
    xs[1] += Base.delta(n);
    return read(xs);
  }
}
class Fraction extends Base {
  static override divisor: number = 4;
  static override delta(n: number): number { return n > 0 ? n / this.divisor : 0; }
}
class Further extends Fraction { static override divisor: number = 8; }
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(Base.run(n), 2);
  assert.sameValue(Fraction.run(n), 2);
  assert.sameValue(Further.run(n), 2);
}
