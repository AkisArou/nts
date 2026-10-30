/*---
description: A continue edge carries negative zero into later remainder operations.
features: [ts-proof-negative-zero, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the entry value is positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: continue carries an exact negative remainder; node preserves -0 on later iterations.
function afterContinue(turns: number): number {
  let value = 0;
  for (let i = 0; i < turns; i++) {
    if (i === 0) {
      value = -6 % 3;
      continue;
    }
    value %= 3;
  }
  return value;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterContinue(n), n === 0 ? 0 : -0);
}
