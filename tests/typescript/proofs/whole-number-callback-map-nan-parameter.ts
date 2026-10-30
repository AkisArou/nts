/*---
description: A mapper forwards NaN through a callee parameter after an initially whole call.
features: [ts-proof-whole-number, ts-route-callback, ts-functions, ts-iteration, ts-numbers, ts-arrow-functions, ts-arrays, ts-closures]
---*/
// Fact: the captured value starts at whole one (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the first callback writes NaN after forwarding one; node keeps NaN on the next call.
function receive(value: number): number {
  return value;
}

function afterMap(n: number): number {
  let value = 1;
  const mapped = [0, 1].map((step) => {
    const seen = receive(value);
    if (step === 0 && n > 0) value = NaN;
    return seen;
  });
  return mapped[1];
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterMap(n), n > 0 ? NaN : 1);
}
