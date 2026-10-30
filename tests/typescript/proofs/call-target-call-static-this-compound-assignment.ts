/*---
description: A compound-assignment operand dispatches a static override that replaces a known function field.
features: [ts-proof-call-target, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-function-types, ts-closures, ts-arrow-functions, ts-objects]
---*/
// Fact: a known receiver or closure permits a direct call (docs/foundations/objects.md, Calls).
// Route: this.change installs a receiver-capturing function; node calls that replacement instead of the initial target.
function original(): number { return 11; }
class Base {
  static offset: number = 0;
  static change(holder: { target: () => number }, n: number): number { return 0; }
  static run(n: number) {
    const holder = { target: original };
    let changed = 0;
    changed += this.change(holder, n);
    return { value: holder.target(), changed };
  }
}
class Replace extends Base {
  static override offset: number = 200;
  static override change(holder: { target: () => number }, n: number): number {
    if (n <= 0) return 0;
    holder.target = () => this.offset + n;
    return 1;
  }
}
class Further extends Replace { static override offset: number = 300; }
function check(Target: typeof Base, n: number, expected: number, changed: number): void {
  const result = Target.run(n);
  assert.sameValue(result.value, expected);
  assert.sameValue(result.changed, changed);
}
for (const n of [-1, 0, 1, 3, 7]) {
  check(Base, n, 11, 0);
  check(Replace, n, n > 0 ? 200 + n : 11, n > 0 ? 1 : 0);
  check(Further, n, n > 0 ? 300 + n : 11, n > 0 ? 1 : 0);
}
