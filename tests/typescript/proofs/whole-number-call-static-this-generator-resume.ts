/*---
description: A resumed static override moves an integer to the unsafe-integer boundary before spacing arithmetic.
features: [ts-proof-whole-number, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-numbers, ts-objects, ts-generators]
---*/
// Fact: literal integers can use integer storage (docs/foundations/numbers.md, Integers proved from doubles).
// Route: this.change uses the actual receiver scale; node gives a zero or two spacing where stale integer arithmetic gives one.
class Base {
  static scale: number = 0;
  static change(state: { value: number }, n: number): void {}
  static *run(n: number): Generator<number, number, void> {
    const state = { value: 1 };
    yield state.value;
    this.change(state, n);
    return (state.value + 1) - state.value;
  }
}
class Wide extends Base {
  static override scale: number = 1;
  static override change(state: { value: number }, n: number): void {
    if (n > 0) state.value = 9007199254740992 + this.scale * n;
  }
}
class Further extends Wide { static override scale: number = 2; }
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
  check(Wide, n, n > 0 ? 0 : 1);
  check(Further, n, n > 0 ? 2 : 1);
}
