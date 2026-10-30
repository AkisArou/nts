/*---
description: Control for capture-accessor-setter-writes-binding; the invalidating route is removed.
features: [ts-proof-capture, ts-route-accessor, ts-functions, ts-iteration, ts-closures, ts-accessors, ts-objects]
---*/
// Paired subject: ../proofs/capture-accessor-setter-writes-binding.ts.
// Only the invalidating route is removed; assertions observe the unchanged fact.
function afterSetter(n: number): number {
  let value = 0;
  const read = (): number => value;
  const hook = { set next(next: number) {  } };
  hook.next = n;
  return read();
}
for (const n of [-1, 0, 1, 3, 7]) assert.sameValue(afterSetter(n), 0);
