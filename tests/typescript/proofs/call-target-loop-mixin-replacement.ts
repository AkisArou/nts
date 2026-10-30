/*---
description: A loop back edge can carry the mixin class expression to the next call.
features: [ts-proof-call-target, ts-route-loop, ts-functions, ts-iteration, ts-class, ts-class-expression, ts-mixins, ts-inheritance]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the returned subclass reaches a later loop call; node runs its override.
class Base { run(n: number): number { return 100 + n; } }
function enhance(Parent: new () => Base) {
  return class extends Parent { override run(n: number): number { return 200 + n; } };
}
const Mixed = enhance(Base);

function afterTurns(turns: number): number {
  let target: Base = new Base();
  let result = 101;
  for (let i = 0; i < turns; i++) {
    result = target.run(1);
    target = new Mixed();
  }
  return result;
}
for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), n < 2 ? 101 : 201);
}
