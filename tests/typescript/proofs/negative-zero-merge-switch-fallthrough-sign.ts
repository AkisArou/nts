/*---
description: Switch fall-through carries a negative-zero remainder to the join.
features: [ts-proof-negative-zero, ts-route-merge, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the binding initially holds positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: fall-through supplies a negative exact multiple to remainder; node gives -0.
function afterJoin(n: number): number {
  let value = 0;
  switch (n) {
    case 0: break;
    case 1: value = -3;
    case 2: value %= 3; break;
    default: value = 0;
  }
  return value;
}

for (const n of [-1, 0, 1, 2, 3, 7]) {
  assert.sameValue(afterJoin(n), n === 1 ? -0 : 0);
}
