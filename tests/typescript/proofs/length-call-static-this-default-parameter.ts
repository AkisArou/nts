/*---
description: A default-parameter static call changes the fixed allocated length to its subclass field.
features: [ts-proof-length, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-arrays, ts-default-parameters]
---*/
// Fact: a fresh allocation has a known length (docs/foundations/objects.md, Arrays).
// Route: the omitted argument calls this.change; node observes length one or two and preserves four for an explicit argument.
class Base {
  static size: number = 4;
  static change(xs: number[], n: number): number { return 0; }
  static execute(xs: number[], n: number, changed = this.change(xs, n)): number { return changed; }
  static run(n: number, supplied: boolean): number {
    const xs = new Array<number>(4);
    this.execute(xs, n, supplied ? 0 : undefined);
    return xs.length;
  }
}
class Shrink extends Base {
  static override size: number = 1;
  static override change(xs: number[], n: number): number {
    if (n > 0) xs.length = this.size;
    return 0;
  }
}
class Further extends Shrink { static override size: number = 2; }
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(Base.run(n, false), 4);
  assert.sameValue(Shrink.run(n, false), n > 0 ? 1 : 4);
  assert.sameValue(Further.run(n, false), n > 0 ? 2 : 4);
  assert.sameValue(Further.run(n, true), 4);
}
