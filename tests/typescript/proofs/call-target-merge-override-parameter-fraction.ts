/*---
description: An override selected at a join receives its fractional numeric argument unchanged.
features: [ts-proof-call-target, ts-route-merge, ts-functions, ts-iteration, ts-class, ts-inheritance, ts-override, ts-numbers]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: one edge changes target and argument representation; node keeps the half.
class Base { run(n: number): number { return 100 + n; } }
class Fraction extends Base { override run(n: number): number { return 200 + n; } }
function afterChoice(n: number): number {
  let target: Base = new Base();
  let value = n | 0;
  if (n > 0) { target = new Fraction(); value = n + 0.5; }
  return target.run(value);
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterChoice(n), n > 0 ? 200.5 + n : 100 + n);
}
