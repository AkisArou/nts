/*---
description: A mandatory do-while negation changes zero sign even when the limit is zero.
features: [ts-proof-negative-zero, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the entry value is positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the body always negates once; node gives -0 for a zero or odd positive limit.
function afterDoWhile(turns: number): number {
  let value = 0;
  let i = 0;
  do {
    value = -value;
    i++;
  } while (i < turns);
  return value;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterDoWhile(n), n === 0 || n % 2 === 1 ? -0 : 0);
}
