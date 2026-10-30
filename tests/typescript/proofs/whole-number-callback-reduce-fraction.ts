/*---
description: A later reducer invocation receives a fractional accumulator.
features: [ts-proof-whole-number, ts-route-callback, ts-functions, ts-iteration, ts-numbers, ts-arrow-functions, ts-arrays]
---*/
// Fact: the reducer is seeded with the whole integer seven (docs/foundations/numbers.md, Integers proved from doubles).
// Route: one callback halves the accumulator; node retains 3.5 on later invocations.
function afterReduce(n: number): number {
  return [0, 1, 2].reduce((value, step) => {
    return step === n ? value / 2 : value;
  }, 7);
}

for (const n of [-1, 0, 1, 2, 3, 7]) {
  assert.sameValue(afterReduce(n), n >= 0 && n < 3 ? 3.5 : 7);
}
