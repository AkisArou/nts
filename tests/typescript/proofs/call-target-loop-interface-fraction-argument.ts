/*---
description: A loop-carried interface target accepts the later fractional argument.
features: [ts-proof-call-target, ts-route-loop, ts-functions, ts-iteration, ts-interfaces, ts-class, ts-numbers]
---*/
// Fact: known receiver or closure classes allow direct calls (docs/foundations/objects.md, Calls).
// Route: the next iteration changes both implementation and argument width; node keeps 3.5.
interface Worker { run(n: number): number; }
class First implements Worker { run(n: number): number { return 100 + n; } }
class Second implements Worker { run(n: number): number { return 200 + n; } }

function afterTurns(turns: number): number {
  let target: Worker = new First();
  let value = 1;
  let result = 101;
  for (let i = 0; i < turns; i++) {
    result = target.run(value);
    target = new Second();
    value = 3.5;
  }
  return result;
}
for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), n < 2 ? 101 : 203.5);
}
