/*---
description: A continue edge carries a fraction into subsequent arithmetic.
features: [ts-proof-whole-number, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial zero is a whole int32 (docs/foundations/numbers.md, Integers proved from doubles).
// Route: continue carries 0.5 to the next iteration; node retains its fraction.
function afterContinue(turns: number): number {
  let value = 0;
  for (let i = 0; i < turns; i++) {
    if (i === 0) {
      value = 0.5;
      continue;
    }
    value += 1;
  }
  return value;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterContinue(n), n === 0 ? 0 : n - 0.5);
}
