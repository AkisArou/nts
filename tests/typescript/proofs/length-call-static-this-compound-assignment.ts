/*---
description: A compound-assignment operand dispatches a static writer that appends a receiver-specific number of elements.
features: [ts-proof-length, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-arrays, ts-objects]
---*/
// Fact: a fresh allocation has a known length (docs/foundations/objects.md, Arrays).
// Route: this.change appends inside the compound operand; node observes lengths four or five instead of three.
class Base {
  static count: number = 0;
  static change(xs: number[], n: number): number { return 0; }
  static run(n: number) {
    const xs = [11, 22, 33];
    let changed = 0;
    changed += this.change(xs, n);
    return { length: xs.length, changed };
  }
}
class Append extends Base {
  static override count: number = 1;
  static override change(xs: number[], n: number): number {
    if (n <= 0) return 0;
    for (let i = 0; i < this.count; i++) xs.push(n + i);
    return this.count;
  }
}
class Further extends Append { static override count: number = 2; }
function check(Target: typeof Base, n: number, expected: number, changed: number): void {
  const result = Target.run(n);
  assert.sameValue(result.length, expected);
  assert.sameValue(result.changed, changed);
}
for (const n of [-1, 0, 1, 3, 7]) {
  check(Base, n, 3, 0);
  check(Append, n, n > 0 ? 4 : 3, n > 0 ? 1 : 0);
  check(Further, n, n > 0 ? 5 : 3, n > 0 ? 2 : 0);
}
