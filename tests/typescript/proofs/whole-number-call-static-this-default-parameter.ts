/*---
description: A static default-parameter override writes beyond int32 into a previously small numeric field.
features: [ts-proof-whole-number, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-numbers, ts-objects, ts-default-parameters]
---*/
// Fact: literal integers can use integer storage (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the default calls this.change; node preserves the receiver-specific value above 2^31 and an explicit argument skips it.
class Base {
  static scale: number = 0;
  static change(state: { value: number }, n: number): number { return 0; }
  static execute(state: { value: number }, n: number, changed = this.change(state, n)): number { return changed; }
  static run(n: number, supplied: boolean): number {
    const state = { value: 12 };
    this.execute(state, n, supplied ? 0 : undefined);
    return state.value;
  }
}
class Wide extends Base {
  static override scale: number = 1;
  static override change(state: { value: number }, n: number): number {
    if (n > 0) state.value = 2147483648 + this.scale * n;
    return 0;
  }
}
class Further extends Wide { static override scale: number = 3; }
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(Base.run(n, false), 12);
  assert.sameValue(Wide.run(n, false), n > 0 ? 2147483648 + n : 12);
  assert.sameValue(Further.run(n, false), n > 0 ? 2147483648 + 3 * n : 12);
  assert.sameValue(Further.run(n, true), 12);
}
