/*---
description: A loop counter crossing the signed 32-bit boundary does not wrap.
features: [ts-proof-whole-number, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial literal fits int32 (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the back edge carries +1 past int32; node keeps 2147483648 and beyond.
function afterTurns(turns: number): number {
  let value = 2147483647;
  for (let i = 0; i < turns; i++) {
    value++;
  }
  return value;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), 2147483647 + n);
}
