/*---
description: Control for call-target-loop-static-this-replacement; the invalidating route is removed.
features: [ts-proof-call-target, ts-route-loop, ts-functions, ts-iteration, ts-class, ts-inheritance, ts-static, ts-this]
---*/
// Paired subject: ../proofs/call-target-loop-static-this-replacement.ts.
// Only the invalidating route is removed; assertions observe the unchanged fact.
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
    
  }
  return result;
}
for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), 101);
}
