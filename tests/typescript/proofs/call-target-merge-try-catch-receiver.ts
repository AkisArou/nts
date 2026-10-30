/*---
description: Normal and caught paths can select different receiver classes.
features: [ts-proof-call-target, ts-route-merge, ts-functions, ts-iteration, ts-class, ts-inheritance, ts-override, ts-errors]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the catch edge installs Next before the join; node calls its override.
class Base { run(n: number): number { return 100 + n; } }
class Next extends Base { override run(n: number): number { return 200 + n; } }

function afterCatch(n: number): number {
  let target: Base = new Base();
  try {
    if (n > 0) throw new Error("change");
  } catch {
    target = new Next();
  }
  return target.run(n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterCatch(n), (n > 0 ? 200 : 100) + n);
}
