/*---
description: A conditional join retains the selected closure body.
features: [ts-proof-call-target, ts-route-merge, ts-functions, ts-iteration, ts-closures, ts-function-types]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the conditional installs a second closure class; node calls that body.
function afterChoice(n: number): number {
  const base = n + 100;
  let action: () => number = () => base;
  action = n > 0 ? () => base + 100 : action;
  return action();
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterChoice(n), (n > 0 ? 200 : 100) + n);
}
