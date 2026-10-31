/*---
description: A resumed static override widens an array element before a separate reader performs unsafe-integer arithmetic.
features: [ts-proof-element-kind, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-numbers, ts-arrays, ts-generators]
---*/
// Fact: integer-only array stores permit integer elements (docs/foundations/objects.md, Arrays).
// Route: this.change stores beyond the safe range; node computes a receiver-specific zero or two spacing inside the reader.
function spacing(xs: number[]): number { return (xs[1] + 1) - xs[1]; }
class Base {
  static scale: number = 0;
  static change(xs: number[], n: number): void {}
  static *run(n: number): Generator<number, number, void> {
    const xs = [1, 2, 3];
    yield spacing(xs);
    this.change(xs, n);
    return spacing(xs);
  }
}
class Wide extends Base {
  static override scale: number = 1;
  static override change(xs: number[], n: number): void {
    if (n > 0) xs[1] = 9007199254740992 + this.scale * n;
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
