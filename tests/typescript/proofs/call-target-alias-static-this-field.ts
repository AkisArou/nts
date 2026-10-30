/*---
description: An alias replaces the constructor used by an inherited static method.
features: [ts-proof-call-target, ts-route-alias, ts-functions, ts-iteration, ts-objects, ts-class, ts-inheritance, ts-static, ts-this]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: a constructor field store changes static this; node calls its which override.
class Base {
  static which(): number { return 100; }
  static run(n: number): number { return this.which() + n; }
}
class Next extends Base { static override which(): number { return 200; } }

function afterAlias(n: number): number {
  const holder: { Target: typeof Base } = { Target: Base };
  const alias = holder;
  if (n > 0) alias.Target = Next;
  return holder.Target.run(n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterAlias(n), (n > 0 ? 200 : 100) + n);
}
