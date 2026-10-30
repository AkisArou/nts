/*---
description: A returned constructor changes the override reached by an inherited static method.
features: [ts-proof-call-target, ts-route-call, ts-functions, ts-iteration, ts-class, ts-inheritance, ts-static, ts-this]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the returned constructor changes static this; node calls its which override.
class Base {
  static which(): number { return 100; }
  static run(n: number): number { return this.which() + n; }
}
class Next extends Base { static override which(): number { return 200; } }

function choose(original: typeof Base, n: number): typeof Base {
  return n > 0 ? Next : original;
}
function afterCall(n: number): number {
  let Target: typeof Base = Base;
  Target = choose(Target, n);
  return Target.run(n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterCall(n), (n > 0 ? 200 : 100) + n);
}
