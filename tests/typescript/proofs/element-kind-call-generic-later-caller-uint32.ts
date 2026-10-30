/*---
description: A later generic caller widens an array element beyond the uint32 range.
features: [ts-proof-element-kind, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-generics]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: another caller stores 4294967296; the separate read must preserve it.
function store<T>(xs: T[], value: T): void { xs[0] = value; }
function smallCaller(xs: number[]): void { store<number>(xs, 1); }
function largeCaller(xs: number[]): void { store<number>(xs, 4294967296); }
function readFirst(xs: number[]): number { return xs[0]; }
function observe(n: number): number {
  const xs = [1, 2];
  smallCaller(xs);
  if (n > 0) largeCaller(xs);
  return readFirst(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? 4294967296 : 1);
}
