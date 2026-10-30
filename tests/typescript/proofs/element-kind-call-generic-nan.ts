/*---
description: A later generic call contributes NaN after an integer generic store.
features: [ts-proof-element-kind, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-generics]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: the later generic call stores NaN; a separate reader observes NaN.
function store<T>(xs: T[], value: T): void { xs[0] = value; }
function readFirst(xs: number[]): number { return xs[0]; }
function observe(n: number): number {
  const xs = [1, 2];
  store<number>(xs, 1);
  if (n > 0) store<number>(xs, NaN);
  return readFirst(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? NaN : 1);
}
