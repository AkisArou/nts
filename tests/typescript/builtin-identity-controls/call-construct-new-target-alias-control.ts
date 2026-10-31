/*---
description: Control for call-construct-new-target-alias; use the direct target.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-new-target, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-typeof-type]
---*/
// Paired case: ../builtin-identity/call-construct-new-target-alias.ts.
// Only the invocation target becomes direct; inputs and checks are unchanged.
class Base {
  readonly seen: typeof Base;
  readonly value: number;
  constructor(n: number) { this.seen = new.target; this.value = n; }
}
class Derived extends Base {
  constructor(n: number) { super(n + 10); }
}
function build(n: number): Base {
  const target: typeof Base = Derived;
  return new Derived(n);
}
for (const n of [-3, 0, 7]) {
  const result = build(n);
  assert.sameValue(result.seen, Derived);
  assert.notSameValue(result.seen, Base);
  assert.sameValue(result.value, n + 10);
  assert.sameValue(result instanceof Derived, true);
  assert.sameValue(result instanceof Base, true);
}
