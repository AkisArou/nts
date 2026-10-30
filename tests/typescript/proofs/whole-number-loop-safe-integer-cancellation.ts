/*---
description: A later increment at 2^53 makes no change before subtraction.
features: [ts-proof-whole-number, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial value and previous value are safe integers (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the back edge reaches 2^53; node gives a second-step difference of 0, not 1.
function lastIncrement(turns: number): number {
  let value = 9007199254740991;
  let previous = value;
  for (let i = 0; i < turns; i++) {
    previous = value;
    value++;
  }
  return value - previous;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(lastIncrement(n), n === 1 ? 1 : 0);
}
