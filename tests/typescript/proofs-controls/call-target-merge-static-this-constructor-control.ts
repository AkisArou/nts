/*---
description: Control for call-target-merge-static-this-constructor; the invalidating route is removed.
features: [ts-proof-call-target, ts-route-merge, ts-functions, ts-iteration, ts-class, ts-inheritance, ts-static, ts-this]
---*/
// Paired subject: ../proofs/call-target-merge-static-this-constructor.ts.
// Only the invalidating route is removed; assertions observe the unchanged fact.
class Base {
  static which(): number { return 100; }
  static run(n: number): number { return this.which() + n; }
}
class Next extends Base { static override which(): number { return 200; } }

function afterChoice(n: number): number {
  let Target: typeof Base = Base;
  
  return Target.run(n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterChoice(n), 100 + n);
}
