/*---
description: A resumed static override replaces a positive number with receiver-specific signed zero before division.
features: [ts-proof-negative-zero, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-numbers, ts-objects, ts-generators]
---*/
// Fact: a positive value or +0 has no negative-zero sign (docs/foundations/numbers.md, Integers proved from doubles).
// Route: this.change writes the signed product after yield; node returns negative or positive infinity from its reciprocal.
class Base {
  static sign: number = 1;
  static change(state: { value: number }, n: number): void {}
  static *run(n: number): Generator<number, number, void> {
    const state = { value: 1 };
    yield state.value;
    this.change(state, n);
    return 1 / state.value;
  }
}
class Negative extends Base {
  static override sign: number = -1;
  static override change(state: { value: number }, n: number): void {
    if (n > 0) state.value = (this.sign * n) * 0;
  }
}
class Positive extends Negative { static override sign: number = 1; }
function check(Target: typeof Base, n: number, expected: number): void {
  const steps = Target.run(n), before = steps.next();
  assert.sameValue(before.done, false);
  assert.sameValue(before.value, 1);
  const after = steps.next();
  assert.sameValue(after.done, true);
  assert.sameValue(after.value, expected);
}
for (const n of [-1, 0, 1, 3, 7]) {
  check(Base, n, 1);
  check(Negative, n, n > 0 ? -Infinity : 1);
  check(Positive, n, n > 0 ? Infinity : 1);
}
