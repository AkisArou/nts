/*---
description: A generic writer preserves the fraction stored into a number array.
features: [ts-proof-element-kind, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-generics]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: a generic call stores 3.5; a separate numeric reader retains it.
function store<T>(xs: T[], value: T): void { xs[0] = value; }
function readFirst(xs: number[]): number { return xs[0]; }
function observe(n: number): number {
  const xs = [1, 2];
  store<number>(xs, n > 0 ? 3.5 : 1);
  return readFirst(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? 3.5 : 1);
}
