/*---
description: A static destructuring default replaces a small integer with NaN or infinity selected by its receiver.
features: [ts-proof-whole-number, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-numbers, ts-objects, ts-destructuring, ts-class-expression]
---*/
// Fact: literal integers can use integer storage (docs/foundations/numbers.md, Integers proved from doubles).
// Route: this.change divides around the receiver-specific edge; node retains NaN and both infinity signs after the call.
class Base {
  static edge: number = 0;
  static change(state: { value: number }, n: number): number { return 0; }
  static run(n: number, supplied: boolean) {
    const state = { value: 12 };
    const { changed = this.change(state, n) }: { changed?: number } = supplied ? { changed: 0 } : {};
    return { value: state.value, changed };
  }
}
const Special = class extends Base {
  static override edge: number = 1;
  static override change(state: { value: number }, n: number): number {
    if (n > 0) state.value = (n - this.edge) / 0;
    return 0;
  }
};
const Further = class extends Special { static override edge: number = 3; };
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(Base.run(n, false).value, 12);
  assert.sameValue(Special.run(n, false).value, n <= 0 ? 12 : n === 1 ? NaN : Infinity);
  assert.sameValue(Further.run(n, false).value, n <= 0 ? 12 : n === 1 ? -Infinity : n === 3 ? NaN : Infinity);
  assert.sameValue(Further.run(n, true).value, 12);
}
