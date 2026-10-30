/*---
description: A nullish join can replace a known interface implementation.
features: [ts-proof-call-target, ts-route-merge, ts-functions, ts-iteration, ts-interfaces, ts-class, ts-expressions, ts-null-undefined, ts-unions]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: only nullish input installs Second; node keeps First for zero.
interface Worker { run(n: number): number; }
class First implements Worker { run(n: number): number { return 100 + n; } }
class Second implements Worker { run(n: number): number { return 200 + n; } }

function afterNullish(value: number | null | undefined): number {
  let target: Worker = new First();
  value ?? (target = new Second());
  return target.run(1);
}
for (const value of [0, 1, 3, null, undefined]) {
  assert.sameValue(afterNullish(value), value === null || value === undefined ? 201 : 101);
}
