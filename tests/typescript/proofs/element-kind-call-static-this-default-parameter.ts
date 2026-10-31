/*---
description: A static default-parameter override stores a value beyond int32 into an initially small integer array.
features: [ts-proof-element-kind, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-numbers, ts-arrays, ts-default-parameters]
---*/
// Fact: integer-only array stores permit integer elements (docs/foundations/objects.md, Arrays).
// Route: the omitted argument calls this.change; node preserves the wide element through a separate reader.
function read(xs: number[]): number { return xs[0]; }
class Base {
  static scale: number = 0;
  static change(xs: number[], n: number): number { return 0; }
  static execute(xs: number[], n: number, changed = this.change(xs, n)): number { return changed; }
  static run(n: number, supplied: boolean): number {
    const xs = [1, 2, 3];
    this.execute(xs, n, supplied ? 0 : undefined);
    return read(xs);
  }
}
class Wide extends Base {
  static override scale: number = 1;
  static override change(xs: number[], n: number): number {
    if (n > 0) xs[0] = 2147483648 + this.scale * n;
    return 0;
  }
}
class Further extends Wide { static override scale: number = 3; }
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(Base.run(n, false), 1);
  assert.sameValue(Wide.run(n, false), n > 0 ? 2147483648 + n : 1);
  assert.sameValue(Further.run(n, false), n > 0 ? 2147483648 + 3 * n : 1);
  assert.sameValue(Further.run(n, true), 1);
}
