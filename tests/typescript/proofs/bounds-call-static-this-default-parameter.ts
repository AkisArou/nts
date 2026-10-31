/*---
description: A static default-parameter call removes a guarded element while an explicit argument suppresses the mutation.
features: [ts-proof-bounds, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-null-undefined, ts-default-parameters]
---*/
// Fact: a literal length and guard prove the index in range (docs/foundations/objects.md, Arrays).
// Route: the default dispatches this.change; node keeps index one after one removal and returns undefined after two.
class Base {
  static drop: number = 0;
  static change(xs: number[], n: number): number { return 0; }
  static execute(xs: number[], n: number, changed = this.change(xs, n)): number { return changed; }
  static run(n: number, supplied: boolean) {
    const xs = [11, 22, 33], index = 1;
    if (index >= xs.length) return { value: -1, changed: 0 };
    const changed = this.execute(xs, n, supplied ? 0 : undefined);
    return { value: xs[index], changed };
  }
}
class Shrink extends Base {
  static override drop: number = 1;
  static override change(xs: number[], n: number): number {
    if (n <= 0) return 0;
    xs.splice(xs.length - this.drop);
    return this.drop;
  }
}
class Shorter extends Shrink { static override drop: number = 2; }
function check(Target: typeof Base, n: number, supplied: boolean, expected: number | undefined, changed: number): void {
  const result = Target.run(n, supplied);
  assert.sameValue(result.value, expected);
  assert.sameValue(result.changed, changed);
}
for (const n of [-1, 0, 1, 3, 7]) {
  check(Base, n, false, 22, 0);
  check(Shrink, n, false, 22, n > 0 ? 1 : 0);
  check(Shorter, n, false, n > 0 ? undefined : 22, n > 0 ? 2 : 0);
  check(Shorter, n, true, 22, 0);
}
