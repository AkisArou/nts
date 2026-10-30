/*---
description: An inner-loop receiver replacement survives into the next outer iteration.
features: [ts-proof-call-target, ts-route-loop, ts-functions, ts-iteration, ts-class, ts-inheritance]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the inner update reaches a later inner or outer call; node runs Next.run.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

function afterNested(turns: number): number {
  let target: Base = new Base();
  let result = 101;
  for (let outer = 0; outer < 2; outer++) {
    for (let inner = 0; inner < turns; inner++) {
      result = target.run(1);
      if (outer === 0) target = new Next();
    }
  }
  return result;
}
for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterNested(n), n === 0 ? 101 : 201);
}
