/*---
description: A branch can replace a concrete receiver with a mixin class expression.
features: [ts-proof-call-target, ts-route-merge, ts-functions, ts-iteration, ts-class, ts-class-expression, ts-mixins, ts-inheritance]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the branch installs the returned subclass; node runs the mixin override.
class Base { run(n: number): number { return 100 + n; } }
function enhance(Parent: new () => Base) {
  return class extends Parent { override run(n: number): number { return 200 + n; } };
}
const Mixed = enhance(Base);

function afterMixinChoice(n: number): number {
  let target: Base = new Base();
  if (n > 0) target = new Mixed();
  return target.run(n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterMixinChoice(n), (n > 0 ? 200 : 100) + n);
}
