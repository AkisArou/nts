/*---
description: Control for call-target-alias-static-this-field; the invalidating route is removed.
features: [ts-proof-call-target, ts-route-alias, ts-functions, ts-iteration, ts-objects, ts-class, ts-inheritance, ts-static, ts-this]
---*/
// Paired subject: ../proofs/call-target-alias-static-this-field.ts.
// Only the invalidating route is removed; assertions observe the unchanged fact.
class Base {
  static which(): number { return 100; }
  static run(n: number): number { return this.which() + n; }
}
class Next extends Base { static override which(): number { return 200; } }

function afterAlias(n: number): number {
  const holder: { Target: typeof Base } = { Target: Base };
  const alias = holder;
  
  return holder.Target.run(n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterAlias(n), 100 + n);
}
