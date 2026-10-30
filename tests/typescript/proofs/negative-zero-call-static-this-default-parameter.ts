/*---
description: A static default-parameter override writes signed zero using its inherited receiver divisor.
features: [ts-proof-negative-zero, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-numbers, ts-objects, ts-default-parameters]
---*/
// Fact: a positive value or +0 has no negative-zero sign (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the default calls this.change; node preserves -0 divided by positive one and +0 divided by negative one.
class Base {
  static divisor: number = 1;
  static change(state: { value: number }, n: number): number { return 0; }
  static execute(state: { value: number }, n: number, changed = this.change(state, n)): number { return changed; }
  static run(n: number, supplied: boolean): number {
    const state = { value: 0 };
    this.execute(state, n, supplied ? 0 : undefined);
    return state.value;
  }
}
class Negative extends Base {
  static override divisor: number = 1;
  static override change(state: { value: number }, n: number): number {
    if (n > 0) state.value = (0 * -n) / this.divisor;
    return 0;
  }
}
class Positive extends Negative { static override divisor: number = -1; }
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(Base.run(n, false), 0);
  assert.sameValue(Negative.run(n, false), n > 0 ? -0 : 0);
  assert.sameValue(Positive.run(n, false), 0);
  assert.sameValue(Negative.run(n, true), 0);
}
