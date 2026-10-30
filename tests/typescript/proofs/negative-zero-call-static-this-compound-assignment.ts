/*---
description: A static multiplier override gives a literal positive zero an observable negative sign.
features: [ts-proof-negative-zero, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: a positive value or +0 has no negative-zero sign (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the inherited *= calls this.factor; node returns -0 only for the negative receiver and positive input.
class Base {
  static sign: number = 1;
  static factor(n: number): number { return 1; }
  static run(n: number): number {
    let value = 0;
    value *= this.factor(n);
    return value;
  }
}
class Negative extends Base {
  static override sign: number = -1;
  static override factor(n: number): number { return n > 0 ? this.sign : 1; }
}
class Positive extends Negative { static override sign: number = 1; }
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(Base.run(n), 0);
  assert.sameValue(Negative.run(n), n > 0 ? -0 : 0);
  assert.sameValue(Positive.run(n), 0);
}
