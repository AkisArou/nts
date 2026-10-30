/*---
description: A static override supplies a fractional compound-assignment operand to a literal integer.
features: [ts-proof-whole-number, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: literal integers can use integer storage (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the inherited += calls this.delta; node keeps the quarter or eighth selected by the actual receiver.
class Base {
  static divisor: number = 1;
  static delta(n: number): number { return 0; }
  static run(n: number): number {
    let value = 12;
    value += this.delta(n);
    return value;
  }
}
class Fraction extends Base {
  static override divisor: number = 4;
  static override delta(n: number): number { return n > 0 ? n / this.divisor : 0; }
}
class Further extends Fraction { static override divisor: number = 8; }
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(Base.run(n), 12);
  assert.sameValue(Fraction.run(n), n > 0 ? 12 + n / 4 : 12);
  assert.sameValue(Further.run(n), n > 0 ? 12 + n / 8 : 12);
}
