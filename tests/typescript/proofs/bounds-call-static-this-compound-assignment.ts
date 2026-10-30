/*---
description: A static override shrinks a guarded array inside a compound-assignment operand.
features: [ts-proof-bounds, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-null-undefined]
---*/
// Fact: a literal length and guard prove the index in range (docs/foundations/objects.md, Arrays).
// Route: the inherited method compounds this.change; node reads undefined after a two-element shrink and 33 after one.
class Base {
  static drop: number = 0;
  static change(xs: number[], n: number): number { return 0; }
  static run(n: number) {
    const xs = [11, 22, 33, 44], index = 2;
    let changed = 0;
    if (index >= xs.length) return { value: -1, changed };
    changed += this.change(xs, n);
    return { value: xs[index], changed };
  }
}
class Shrink extends Base {
  static override drop: number = 2;
  static override change(xs: number[], n: number): number {
    if (n <= 0) return 0;
    xs.length -= this.drop;
    return this.drop;
  }
}
class Shorter extends Shrink { static override drop: number = 1; }
function check(Target: typeof Base, n: number, expected: number | undefined, changed: number): void {
  const result = Target.run(n);
  assert.sameValue(result.value, expected);
  assert.sameValue(result.changed, changed);
}
for (const n of [-1, 0, 1, 3, 7]) {
  check(Base, n, 33, 0);
  check(Shrink, n, n > 0 ? undefined : 33, n > 0 ? 2 : 0);
  check(Shorter, n, 33, n > 0 ? 1 : 0);
}
