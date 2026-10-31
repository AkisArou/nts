/*---
description: A static default-parameter override updates a binding shared with an earlier reader.
features: [ts-proof-capture, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-function-types, ts-closures, ts-arrow-functions, ts-objects, ts-default-parameters]
---*/
// Fact: an unwritten capture may be copied (docs/foundations/objects.md, Functions as values).
// Route: the omitted argument calls this.change and the captured writer; node adds the actual receiver step while an explicit argument skips it.
class Base {
  static step: number = 0;
  static change(write: (amount: number) => void, n: number): number { return 0; }
  static execute(write: (amount: number) => void, n: number, changed = this.change(write, n)): number { return changed; }
  static run(n: number, supplied: boolean) {
    let value = 10;
    const read = (): number => value;
    const write = (amount: number): void => { value += amount; };
    const before = read();
    this.execute(write, n, supplied ? 0 : undefined);
    return { before, after: read() };
  }
}
class Write extends Base {
  static override step: number = 2;
  static override change(write: (amount: number) => void, n: number): number {
    if (n > 0) write(this.step * n);
    return 0;
  }
}
class Further extends Write { static override step: number = 3; }
function check(Target: typeof Base, n: number, supplied: boolean, expected: number): void {
  const result = Target.run(n, supplied);
  assert.sameValue(result.before, 10);
  assert.sameValue(result.after, expected);
}
for (const n of [-1, 0, 1, 3, 7]) {
  check(Base, n, false, 10);
  check(Write, n, false, n > 0 ? 10 + 2 * n : 10);
  check(Further, n, false, n > 0 ? 10 + 3 * n : 10);
  check(Further, n, true, 10);
}
