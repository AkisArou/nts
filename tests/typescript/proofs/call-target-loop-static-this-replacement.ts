/*---
description: A loop-carried constructor changes the override reached through static this.
features: [ts-proof-call-target, ts-route-loop, ts-functions, ts-iteration, ts-class, ts-inheritance, ts-static, ts-this]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the constructor back edge changes static this; node calls the new which override.
class Base {
  static which(): number { return 100; }
  static run(n: number): number { return this.which() + n; }
}
class Next extends Base { static override which(): number { return 200; } }

function afterTurns(turns: number): number {
  let Target: typeof Base = Base;
  let result = 101;
  for (let i = 0; i < turns; i++) {
    result = Target.run(1);
    Target = Next;
  }
  return result;
}
for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), n < 2 ? 101 : 201);
}
