/*---
description: A second caller prevents a whole-only specialization of a numeric parameter.
features: [ts-proof-whole-number, ts-route-call, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the first call site proves every argument int32 with a bitwise operation (docs/foundations/numbers.md, Integers proved from doubles).
// Route: a second caller supplies the wider value; node preserves its value and arithmetic.
function receive(value: number): number {
  return value;
}

for (const n of [0, 1, 3, 7]) {
  assert.sameValue(receive(n | 0), n);
  assert.sameValue(receive(n > 0 ? 3.5 : 1), n > 0 ? 3.5 : 1);
}
