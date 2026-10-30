/*---
description: A continue edge carries the replacement receiver to a later method call.
features: [ts-proof-call-target, ts-route-loop, ts-functions, ts-iteration, ts-class, ts-inheritance]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: continue skips the immediate call but carries Next to a later one.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

function afterContinue(skip: number): number {
  let target: Base = new Base();
  let result = 101;
  for (let i = 0; i < 3; i++) {
    if (i === skip) { target = new Next(); continue; }
    result = target.run(1);
  }
  return result;
}
for (const n of [-1, 0, 1, 2, 3, 7]) {
  assert.sameValue(afterContinue(n), n === 0 || n === 1 ? 201 : 101);
}
