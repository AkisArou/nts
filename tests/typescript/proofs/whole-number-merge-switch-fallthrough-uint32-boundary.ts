/*---
description: A fall-through update leaves the unsigned integer range before joining.
features: [ts-proof-whole-number, ts-route-merge, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial binding is a whole integer in range (docs/foundations/numbers.md, Integers proved from doubles).
// Route: fall-through makes two increments; node retains 4294967296.
function afterJoin(n: number): number {
  let value = 4294967294;
  switch (n) {
    case 0: value++; break;
    case 1: value++;
    case 2: value++; break;
    default: value = 1;
  }
  return value;
}

for (const n of [-1, 0, 1, 2, 7]) {
  assert.sameValue(afterJoin(n), n === 1 ? 4294967296 : n === 0 || n === 2 ? 4294967295 : 1);
}
