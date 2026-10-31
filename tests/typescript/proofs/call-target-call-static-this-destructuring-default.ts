/*---
description: A destructuring default calls a static override that changes a function field to a receiver-specific implementation.
features: [ts-proof-call-target, ts-route-call, ts-class, ts-class-fields, ts-inheritance, ts-static, ts-this, ts-override, ts-functions, ts-iteration, ts-function-types, ts-closures, ts-arrow-functions, ts-objects, ts-destructuring, ts-class-expression]
---*/
// Fact: a known receiver or closure permits a direct call (docs/foundations/objects.md, Calls).
// Route: this.change installs a new function through a class-expression override; node observes its multiplier at the common call.
function original(value: number): number { return value + 10; }
class Base {
  static factor: number = 1;
  static change(holder: { target: (value: number) => number }, n: number): number { return 0; }
  static run(n: number, supplied: boolean) {
    const holder = { target: original };
    const { changed = this.change(holder, n) }: { changed?: number } = supplied ? { changed: 0 } : {};
    return { value: holder.target(n + 1), changed };
  }
}
const Replace = class extends Base {
  static override factor: number = 3;
  static override change(holder: { target: (value: number) => number }, n: number): number {
    if (n > 0) holder.target = value => this.factor * value;
    return 0;
  }
};
const Further = class extends Replace { static override factor: number = 5; };
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(Base.run(n, false).value, n + 11);
  assert.sameValue(Replace.run(n, false).value, n > 0 ? 3 * (n + 1) : n + 11);
  assert.sameValue(Further.run(n, false).value, n > 0 ? 5 * (n + 1) : n + 11);
  assert.sameValue(Further.run(n, true).value, n + 11);
}
