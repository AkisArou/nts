/*---
description: A destructuring default dispatches a static splice that moves a different value into a still-valid index.
features: [ts-proof-bounds, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-destructuring, ts-class-expression]
---*/
// Fact: a literal length and guard prove the index in range (docs/foundations/objects.md, Arrays).
// Route: the default calls this.change on class expressions; node reads 33 or 44 at the same in-range index.
class Base {
  static shift: number = 0;
  static change(xs: number[], n: number): number { return 0; }
  static run(n: number, supplied: boolean) {
    const xs = [11, 22, 33, 44], index = 1;
    if (index >= xs.length) return { value: -1, changed: 0 };
    const { changed = this.change(xs, n) }: { changed?: number } = supplied ? { changed: 0 } : {};
    return { value: xs[index], changed };
  }
}
const Shift = class extends Base {
  static override shift: number = 1;
  static override change(xs: number[], n: number): number {
    if (n <= 0) return 0;
    xs.splice(0, this.shift);
    return this.shift;
  }
};
const Further = class extends Shift { static override shift: number = 2; };
function check(Target: typeof Base, n: number, supplied: boolean, expected: number, changed: number): void {
  const result = Target.run(n, supplied);
  assert.sameValue(result.value, expected);
  assert.sameValue(result.changed, changed);
}
for (const n of [-1, 0, 1, 3, 7]) {
  check(Base, n, false, 22, 0);
  check(Shift, n, false, n > 0 ? 33 : 22, n > 0 ? 1 : 0);
  check(Further, n, false, n > 0 ? 44 : 22, n > 0 ? 2 : 0);
  check(Further, n, true, 22, 0);
}
