/*---
description: A zero-trip loop retains the initial receiver while positive trips replace it.
features: [ts-proof-call-target, ts-route-loop, ts-functions, ts-iteration, ts-class, ts-inheritance]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the loop exit joins the original and replacement receivers; node distinguishes them.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

function afterLoop(turns: number): number {
  let target: Base = new Base();
  for (let i = 0; i < turns; i++) target = new Next();
  return target.run(turns);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterLoop(n), (n > 0 ? 200 : 100) + n);
}
