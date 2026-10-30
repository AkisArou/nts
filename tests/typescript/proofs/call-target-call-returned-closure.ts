/*---
description: A returned closure can replace a previously known closure class.
features: [ts-proof-call-target, ts-route-call, ts-functions, ts-iteration, ts-closures, ts-function-types]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the callee returns another closure class; node calls its distinct body.
function choose(original: () => number, n: number): () => number {
  const value = n + 200;
  return n > 0 ? () => value : original;
}
function afterCall(n: number): number {
  const value = n + 100;
  let action: () => number = () => value;
  action = choose(action, n);
  return action();
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterCall(n), (n > 0 ? 200 : 100) + n);
}
