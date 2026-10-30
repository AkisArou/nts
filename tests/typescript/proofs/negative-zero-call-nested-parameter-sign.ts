/*---
description: A nested caller forwards negative zero through a previously whole parameter.
features: [ts-proof-negative-zero, ts-route-call, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the first inner call receives positive zero (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the outer caller later supplies -0; node retains its sign through the nested call.
function inner(value: number): number {
  return value;
}

function outer(n: number): number {
  const initial = inner(0);
  return inner(n > 0 ? -0 : initial);
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(outer(n), n > 0 ? -0 : 0);
}
