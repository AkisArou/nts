/*---
description: A later iteration invokes the closure class installed on the preceding back edge.
features: [ts-proof-call-target, ts-route-loop, ts-functions, ts-iteration, ts-closures, ts-function-types]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the back edge changes the directly callable closure class; node uses its new body.
function afterTurns(turns: number): number {
  const base = turns + 100;
  let action: () => number = () => base;
  let result = base;
  for (let i = 0; i < turns; i++) {
    result = action();
    action = () => base + 100;
  }
  return result;
}
for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), (n < 2 ? 100 : 200) + n);
}
