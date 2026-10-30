/*---
description: A destructuring default calls a static override that grows a map-derived array.
features: [ts-proof-length, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-arrow-functions, ts-destructuring, ts-class-expression]
---*/
// Fact: a fresh allocation has a known length (docs/foundations/objects.md, Arrays).
// Route: the absent property dispatches this.change; node includes each subclass-specific unshift in the mapped length.
class Base {
  static count: number = 0;
  static change(xs: number[], n: number): number { return 0; }
  static run(n: number, supplied: boolean) {
    const xs = [1, 2, 3].map(value => value + 1);
    const { changed = this.change(xs, n) }: { changed?: number } = supplied ? { changed: 0 } : {};
    return { length: xs.length, changed };
  }
}
const Prepend = class extends Base {
  static override count: number = 2;
  static override change(xs: number[], n: number): number {
    if (n <= 0) return 0;
    for (let i = 0; i < this.count; i++) xs.unshift(n + i);
    return this.count;
  }
};
const Further = class extends Prepend { static override count: number = 4; };
function check(Target: typeof Base, n: number, supplied: boolean, expected: number, changed: number): void {
  const result = Target.run(n, supplied);
  assert.sameValue(result.length, expected);
  assert.sameValue(result.changed, changed);
}
for (const n of [-1, 0, 1, 3, 7]) {
  check(Base, n, false, 3, 0);
  check(Prepend, n, false, n > 0 ? 5 : 3, n > 0 ? 2 : 0);
  check(Further, n, false, n > 0 ? 7 : 3, n > 0 ? 4 : 0);
  check(Further, n, true, 3, 0);
}
