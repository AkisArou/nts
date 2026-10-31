/*---
description: Two array entries retain the original array across a map replacement.
features: [ts-lifetime-in-place, ts-route-container, ts-functions, ts-iteration, ts-arrays, ts-objects]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: array elements hold the same source; Node keeps its identity and entries.
function make(n: number): number[] { return [n, n + 1, n + 2]; }
function check(xs: number[], n: number): void {
  assert.sameValue(xs.length, 3);
  assert.sameValue(xs[0], n); assert.sameValue(xs[1], n + 1); assert.sameValue(xs[2], n + 2);
}
function churn(n: number): void {
  const all: number[][] = [];
  for (let i = 0; i < 24; i++) all.push(make(n + i + 1000));
  for (let i = 0; i < all.length; i++) check(all[i], n + i + 1000);
}

for (let n = 0; n < 240; n++) {
  let xs = make(n);
  const saved = [xs, xs];
  xs = xs.map(value => value + 100);
  churn(n);
  const old = saved[0];
  assert.sameValue(old === saved[1], true);
  assert.sameValue(old === xs, false);
  check(old, n); check(xs, n + 100);
}
