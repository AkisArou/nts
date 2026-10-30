/*---
description: Control for call-target-loop-closure-replacement; the invalidating route is removed.
features: [ts-proof-call-target, ts-route-loop, ts-functions, ts-iteration, ts-closures, ts-function-types]
---*/
// Paired subject: ../proofs/call-target-loop-closure-replacement.ts.
// Only the invalidating route is removed; assertions observe the unchanged fact.
function afterTurns(turns: number): number {
  const base = turns + 100;
  let action: () => number = () => base;
  let result = base;
  for (let i = 0; i < turns; i++) {
    result = action();
    
  }
  return result;
}
for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), 100 + n);
}
