/*---
description: A called index store grows an array beyond its allocated length.
features: [ts-proof-length, ts-route-call, ts-functions, ts-iteration, ts-arrays]
---*/
// Fact: new Array(n) has length n (docs/foundations/objects.md, Arrays).
// Route: the callee writes at its end; node reads n + 1 instead of n.
function appendAtEnd(xs: number[], enabled: boolean): void {
  if (enabled) xs[xs.length] = 99;
}
function lengthAfterIndexCall(n: number, append: boolean): number {
  const xs = new Array<number>(n);
  appendAtEnd(xs, append);
  return xs.length;
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterIndexCall(n, false), n);
  assert.sameValue(lengthAfterIndexCall(n, true), n + 1);
}
