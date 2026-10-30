/*---
description: A do-while replacement runs before the bottom condition even for a zero limit.
features: [ts-proof-call-target, ts-route-loop, ts-functions, ts-iteration, ts-class, ts-inheritance, ts-override]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the mandatory body changes the receiver; node always calls Next.run.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

function afterLoop(turns: number): number {
  let target: Base = new Base();
  let i = 0;
  do { target = new Next(); i++; } while (i < turns);
  return target.run(turns);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterLoop(n), 200 + n);
}
