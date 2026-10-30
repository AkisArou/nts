/*---
description: A wide second caller requires double rounding inside the callee.
features: [ts-proof-whole-number, ts-route-call, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the first call site proves every argument int32 with a bitwise operation (docs/foundations/numbers.md, Integers proved from doubles).
// Route: a second caller supplies the wider value; node preserves its value and arithmetic.
function receive(value: number): number {
  return (value + 1) - value;
}

for (const n of [0, 1, 3, 7]) {
  assert.sameValue(receive(n | 0), 1);
  assert.sameValue(receive(n > 0 ? 9007199254740992 : 1), n > 0 ? 0 : 1);
}
