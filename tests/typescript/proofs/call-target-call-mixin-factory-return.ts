/*---
description: A call returning a mixin instance replaces the original concrete receiver.
features: [ts-proof-call-target, ts-route-call, ts-functions, ts-iteration, ts-class, ts-class-expression, ts-mixins, ts-inheritance]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the returned mixin instance changes the call target; node runs its override.
class Base { run(n: number): number { return 100 + n; } }
function enhance(Parent: new () => Base) {
  return class extends Parent { override run(n: number): number { return 200 + n; } };
}
const Mixed = enhance(Base);

function choose(original: Base, n: number): Base {
  return n > 0 ? new Mixed() : original;
}
function afterCall(n: number): number {
  let target: Base = new Base();
  target = choose(target, n);
  return target.run(n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterCall(n), (n > 0 ? 200 : 100) + n);
}
