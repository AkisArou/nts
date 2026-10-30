/*---
description: Control for bounds-accessor-setter-string-index; the invalidating route is removed.
features: [ts-proof-bounds, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-accessors, ts-objects, ts-strings, ts-closures]
---*/
// Paired subject: ../proofs/bounds-accessor-setter-string-index.ts.
// Only the invalidating route is removed; assertions observe the unchanged fact.
function read(change: number): string {
  const text = "abcd";
  let index = 0;
  const hook = { set effect(n: number) {  } };
  hook.effect = change;
  return text.charAt(index);
}
for (const change of [-1, 0, 1, 4]) assert.sameValue(read(change), "a");
