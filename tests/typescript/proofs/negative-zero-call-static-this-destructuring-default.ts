/*---
description: A destructuring default dispatches a static remainder writer that can introduce negative zero.
features: [ts-proof-negative-zero, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-numbers, ts-objects, ts-destructuring, ts-class-expression]
---*/
// Fact: a positive value or +0 has no negative-zero sign (docs/foundations/numbers.md, Integers proved from doubles).
// Route: this.change reads the receiver modulus; node returns -0 modulo one and -1 modulo two for positive odd inputs.
class Base {
  static modulus: number = 1;
  static change(state: { value: number }, n: number): number { return 0; }
  static run(n: number, supplied: boolean) {
    const state = { value: 0 };
    const { changed = this.change(state, n) }: { changed?: number } = supplied ? { changed: 0 } : {};
    return { value: state.value, changed };
  }
}
const Remainder = class extends Base {
  static override modulus: number = 1;
  static override change(state: { value: number }, n: number): number {
    if (n > 0) state.value = -n % this.modulus;
    return 0;
  }
};
const Further = class extends Remainder { static override modulus: number = 2; };
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(Base.run(n, false).value, 0);
  assert.sameValue(Remainder.run(n, false).value, n > 0 ? -0 : 0);
  assert.sameValue(Further.run(n, false).value, n > 0 ? -1 : 0);
  assert.sameValue(Remainder.run(n, true).value, 0);
}
