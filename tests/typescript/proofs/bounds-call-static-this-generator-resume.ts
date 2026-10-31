/*---
description: An inherited static generator dispatches a shrink followed by append before rereading its guarded index.
features: [ts-proof-bounds, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-arrays, ts-generators]
---*/
// Fact: a literal length and guard prove the index in range (docs/foundations/objects.md, Arrays).
// Route: resumption calls this.change; node reads the appended subclass-specific value at the still-valid index.
class Base {
  static fill: number = 0;
  static change(xs: number[], n: number): void {}
  static *run(n: number): Generator<number, number, void> {
    const xs = [11, 22, 33], index = 1;
    if (index >= xs.length) return -1;
    yield xs[index];
    this.change(xs, n);
    return xs[index];
  }
}
class Append extends Base {
  static override fill: number = 70;
  static override change(xs: number[], n: number): void {
    if (n > 0) { xs.length = 1; xs.push(this.fill + n); }
  }
}
class Further extends Append { static override fill: number = 90; }
function check(Target: typeof Base, n: number, expected: number): void {
  const steps = Target.run(n), before = steps.next();
  assert.sameValue(before.done, false);
  assert.sameValue(before.value, 22);
  const after = steps.next();
  assert.sameValue(after.done, true);
  assert.sameValue(after.value, expected);
}
for (const n of [-1, 0, 1, 3, 7]) {
  check(Base, n, 22);
  check(Append, n, n > 0 ? 70 + n : 22);
  check(Further, n, n > 0 ? 90 + n : 22);
}
