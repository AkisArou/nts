/*---
description: Array.from forwards a wide later value through a numeric callee parameter.
features: [ts-proof-whole-number, ts-route-callback, ts-functions, ts-iteration, ts-numbers, ts-arrow-functions, ts-arrays, ts-closures]
---*/
// Fact: the captured value starts at whole one (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the first callback writes 2^32 after forwarding one; node preserves it on the next call.
function receive(value: number): number {
  return value;
}

function afterFrom(n: number): number {
  let value = 1;
  const mapped = Array.from([0, 1], (step) => {
    const seen = receive(value);
    if (step === 0 && n > 0) value = 4294967296;
    return seen;
  });
  return mapped[1];
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(afterFrom(n), n > 0 ? 4294967296 : 1);
}
