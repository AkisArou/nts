/*---
description: A nested call forwards a fractional argument through an initially whole parameter.
features: [ts-proof-whole-number, ts-route-call, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the first inner call receives the whole literal one (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the outer caller later forwards a fraction; node returns exactly 0.25.
function inner(value: number): number {
  return value;
}

function outer(n: number): number {
  const whole = inner(1);
  return inner(n > 0 ? 0.25 : whole);
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(outer(n), n > 0 ? 0.25 : 1);
}
