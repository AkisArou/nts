/*---
description: An inherited static call dispatches this.which through the selected subclass.
features: [ts-proof-call-target, ts-route-merge, ts-functions, ts-iteration, ts-class, ts-inheritance, ts-static, ts-this]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the constructor join changes static this; node calls Next.which when selected.
class Base {
  static which(): number { return 100; }
  static run(n: number): number { return this.which() + n; }
}
class Next extends Base { static override which(): number { return 200; } }

function afterChoice(n: number): number {
  let Target: typeof Base = Base;
  if (n > 0) Target = Next;
  return Target.run(n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterChoice(n), (n > 0 ? 200 : 100) + n);
}
