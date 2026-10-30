/*---
description: The mandatory do-while update can leave the unsigned 32-bit range.
features: [ts-proof-whole-number, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial literal fits uint32 (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the first body visit crosses uint32 even at limit zero; node keeps the wider value.
function afterDoWhile(turns: number): number {
  let value = 4294967295;
  let i = 0;
  do {
    value++;
    i++;
  } while (i < turns);
  return value;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterDoWhile(n), 4294967295 + (n > 0 ? n : 1));
}
