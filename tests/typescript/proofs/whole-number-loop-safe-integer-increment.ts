/*---
description: Repeated increments beyond the last safe integer retain double rounding.
features: [ts-proof-whole-number, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial literal is MAX_SAFE_INTEGER (docs/foundations/numbers.md, Integers proved from doubles).
// Route: later increments round at 2^53; even three increments give 2^53 in node.
function afterTurns(turns: number): number {
  let value = 9007199254740991;
  for (let i = 0; i < turns; i++) {
    value++;
  }
  return value;
}

for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(afterTurns(n), n === 0 ? 9007199254740991 : 9007199254740992);
}
