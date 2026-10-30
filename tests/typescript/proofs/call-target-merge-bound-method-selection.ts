/*---
description: A branch between bound methods retains each method target and its original receiver.
features: [ts-proof-call-target, ts-route-merge, ts-functions, ts-iteration, ts-class, ts-function-types, ts-this, ts-class-fields, ts-inheritance, ts-override]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the branch selects a bound override; node uses its target and saved receiver.
class Worker {
  offset: number;
  constructor(offset: number) { this.offset = offset; }
  run(n: number): number { return this.offset + n; }
}
class Next extends Worker {
  override run(n: number): number { return this.offset + n + 100; }
}
function afterChoice(n: number): number {
  const first = new Worker(100);
  const second = new Next(100);
  let action = first.run.bind(first, n);
  if (n > 0) action = second.run.bind(second, n);
  return action();
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterChoice(n), (n > 0 ? 200 : 100) + n);
}
