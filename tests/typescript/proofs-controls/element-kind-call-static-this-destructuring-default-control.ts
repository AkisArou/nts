/*---
description: Control. Use only Base.change at the same destructuring-default call site.
features: [ts-proof-element-kind, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-numbers, ts-arrays, ts-objects, ts-destructuring, ts-class-expression]
---*/
// Control: paired with proofs/element-kind-call-static-this-destructuring-default.ts. Use only Base.change at the same destructuring-default call site.
// Fact: integer-only array stores permit integer elements (docs/foundations/objects.md, Arrays).
// Route: this.change uses the class-expression receiver edge; node preserves each special element in a separate reader.
function read(xs: number[]): number { return xs[1]; }
class Base {
  static edge: number = 0;
  static change(xs: number[], n: number): number { return 0; }
  static run(n: number, supplied: boolean) {
    const xs = [1, 2, 3];
    const { changed = Base.change(xs, n) }: { changed?: number } = supplied ? { changed: 0 } : {};
    return { value: read(xs), changed };
  }
}
const Special = class extends Base {
  static override edge: number = 1;
  static override change(xs: number[], n: number): number {
    if (n > 0) xs[1] = (n - this.edge) / 0;
    return 0;
  }
};
const Further = class extends Special { static override edge: number = 3; };
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(Base.run(n, false).value, 2);
  assert.sameValue(Special.run(n, false).value, 2);
  assert.sameValue(Further.run(n, false).value, 2);
  assert.sameValue(Further.run(n, true).value, 2);
}
