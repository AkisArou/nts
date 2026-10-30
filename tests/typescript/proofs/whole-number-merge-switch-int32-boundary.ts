/*---
description: A switch join includes the integer beyond int32.
features: [ts-proof-whole-number, ts-route-merge, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial binding is a whole integer in range (docs/foundations/numbers.md, Integers proved from doubles).
// Route: one switch edge increments past int32; node retains 2147483648.
function afterJoin(n: number): number {
  let value = 2147483647;
  switch (n) {
    case 0: break;
    case 1: value++; break;
    default: value += 2;
  }
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), n === 0 ? 2147483647 : n === 1 ? 2147483648 : 2147483649);
}
