/*---
description: A receiver replacement reaches the next iteration through the back edge.
features: [ts-proof-call-target, ts-route-loop, ts-functions, ts-iteration, ts-class, ts-inheritance, ts-override]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the back edge carries Next to the next call; node runs its override.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

function afterTurns(turns: number): number {
  let target: Base = new Base();
  let result = 101;
  for (let i = 0; i < turns; i++) {
    result = target.run(1);
    target = new Next();
  }
  return result;
}
for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), n < 2 ? 101 : 201);
}
