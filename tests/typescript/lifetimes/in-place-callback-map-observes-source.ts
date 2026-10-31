/*---
description: A map callback reads and retains the source after earlier results were produced.
features: [ts-lifetime-in-place, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-closures]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: map exposes its original array to the callback; Node reads the old first entry and retains all entries.
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
  const saved: number[][] = [];
  let observed = -1;
  xs = xs.map((value, index, source) => {
    if (index === 2) { observed = source[0]; saved.push(source); }
    return value + 100;
  });
  const witness = saved[0];
  churn(n);
  assert.sameValue(observed, n);
  assert.sameValue(saved[0] === witness, true);
  assert.sameValue(saved[0] === xs, false);
  check(saved[0], n); check(xs, n + 100);
}
