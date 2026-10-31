/*---
description: new.target survives a typed field and a forwarding subclass constructor.
features: [ts-builtin-identity, ts-builtin-invocation, ts-functions, ts-iteration, ts-new-target, ts-class, ts-class-fields, ts-inheritance, ts-instanceof, ts-typeof-type]
---*/
// Route: new.target through a subclass selected by a typed field; node preserves the target and argument semantics.
class Base {
  readonly seen: typeof Base;
  readonly value: number;
  constructor(n: number) { this.seen = new.target; this.value = n; }
}
class Derived extends Base {
  constructor(n: number) { super(n + 10); }
}
function build(n: number): Base {
  const holder: { target: typeof Base; value: number } = { target: Derived, value: n };
  return new holder.target(holder.value);
}
for (const n of [-3, 0, 7]) {
  const result = build(n);
  assert.sameValue(result.seen, Derived);
  assert.notSameValue(result.seen, Base);
  assert.sameValue(result.value, n + 10);
  assert.sameValue(result instanceof Derived, true);
  assert.sameValue(result instanceof Base, true);
}
