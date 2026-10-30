/*---
description: A destructuring default dispatches a static writer while preserving the earlier reader of the same cell.
features: [ts-proof-capture, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-function-types, ts-closures, ts-arrow-functions, ts-objects, ts-destructuring, ts-class-expression]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: this.change invokes the writer through the class-expression receiver; node reads its chosen factor from the shared binding.
class Base {
  static factor: number = 0;
  static change(write: (value: number) => void, n: number): number { return 0; }
  static run(n: number, supplied: boolean) {
    let value = 10;
    const read = (): number => value;
    const write = (next: number): void => { value = next; };
    const before = read();
    const { changed = this.change(write, n) }: { changed?: number } = supplied ? { changed: 0 } : {};
    return { before, after: read(), changed };
  }
}
const Write = class extends Base {
  static override factor: number = 20;
  static override change(write: (value: number) => void, n: number): number {
    if (n > 0) write(this.factor * n);
    return 0;
  }
};
const Further = class extends Write { static override factor: number = 30; };
function check(Target: typeof Base, n: number, supplied: boolean, expected: number): void {
  const result = Target.run(n, supplied);
  assert.sameValue(result.before, 10);
  assert.sameValue(result.after, expected);
}
for (const n of [-1, 0, 1, 3, 7]) {
  check(Base, n, false, 10);
  check(Write, n, false, n > 0 ? 20 * n : 10);
  check(Further, n, false, n > 0 ? 30 * n : 10);
  check(Further, n, true, 10);
}
