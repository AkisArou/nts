/*---
description: A finally update contributes a wider integer to the outgoing join.
features: [ts-proof-whole-number, ts-route-merge, ts-functions, ts-iteration, ts-numbers, ts-errors]
---*/
// Fact: the initial binding is a whole integer in range (docs/foundations/numbers.md, Integers proved from doubles).
// Route: finally increments the positive arm past int32; node retains 2147483648.
function afterJoin(n: number): number {
  let value = 2147483647;
  try {
    if (n === 0) value--;
  } finally {
    if (n > 0) value++;
  }
  return value;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterJoin(n), n > 0 ? 2147483648 : n === 0 ? 2147483646 : 2147483647);
}
