/*---
description: A joined wide addend rounds before bitwise truncation.
features: [ts-proof-whole-number, ts-route-merge, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial binding is a whole integer in range (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the wide edge supplies 2^53; node rounds +1 then truncates to 0.
function afterJoin(n: number): number {
  let value = 1;
  if (n > 0) value = 9007199254740992;
  return (value + 1) | 0;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), n > 0 ? 0 : 2);
}
