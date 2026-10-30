/*---
description: A later negative-zero caller prevents an integer-only parameter specialization.
features: [ts-proof-negative-zero, ts-route-call, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the first call site proves every argument int32 (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the second call supplies -0; node preserves its sign through the same parameter.
function receive(value: number): number {
  return value;
}

for (const n of [0, 1, 3, 7]) {
  assert.sameValue(receive(n | 0), n);
  assert.sameValue(receive(n > 0 ? -0 : 0), n > 0 ? -0 : 0);
}
