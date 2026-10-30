/*---
description: A loop counter crossing the unsigned 32-bit boundary keeps the wider integer.
features: [ts-proof-whole-number, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial literal fits uint32 (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the back edge carries +1 past uint32; node keeps 4294967296 and beyond.
function afterTurns(turns: number): number {
  let value = 4294967295;
  for (let i = 0; i < turns; i++) {
    value++;
  }
  return value;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), 4294967295 + n);
}
