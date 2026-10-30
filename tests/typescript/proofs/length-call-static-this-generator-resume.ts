/*---
description: A resumed static generator dispatches a splice override before reading its allocation length.
features: [ts-proof-length, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-arrays, ts-generators]
---*/
// Fact: a fresh allocation has a known length (docs/foundations/objects.md, Arrays).
// Route: the resumed this.change removes one or two elements; node reports three or two after initially yielding four.
class Base {
  static drop: number = 0;
  static change(xs: number[], n: number): void {}
  static *run(n: number): Generator<number, number, void> {
    const xs = [11, 22, 33, 44];
    yield xs.length;
    this.change(xs, n);
    return xs.length;
  }
}
class Shrink extends Base {
  static override drop: number = 1;
  static override change(xs: number[], n: number): void {
    if (n > 0) xs.splice(1, this.drop);
  }
}
class Further extends Shrink { static override drop: number = 2; }
function check(Target: typeof Base, n: number, expected: number): void {
  const steps = Target.run(n), before = steps.next();
  assert.sameValue(before.done, false);
  assert.sameValue(before.value, 4);
  const after = steps.next();
  assert.sameValue(after.done, true);
  assert.sameValue(after.value, expected);
}
for (const n of [-1, 0, 1, 3, 7]) {
  check(Base, n, 4);
  check(Shrink, n, n > 0 ? 3 : 4);
  check(Further, n, n > 0 ? 2 : 4);
}
