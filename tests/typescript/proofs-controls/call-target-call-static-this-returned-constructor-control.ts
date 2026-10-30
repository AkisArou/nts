/*---
description: Control for call-target-call-static-this-returned-constructor; the invalidating route is removed.
features: [ts-proof-call-target, ts-route-call, ts-functions, ts-iteration, ts-class, ts-inheritance, ts-static, ts-this]
---*/
// Paired subject: ../proofs/call-target-call-static-this-returned-constructor.ts.
// Only the invalidating route is removed; assertions observe the unchanged fact.
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
  
  return Target.run(n);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterCall(n), 100 + n);
}
