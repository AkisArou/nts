/*---
description: A nested call from map cannot overwrite the outer array being observed.
features: [ts-lifetime-in-place, ts-route-re-entry, ts-functions, ts-iteration, ts-arrays, ts-closures]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: a callback re-enters update at the same allocation site; Node preserves the outer source and result.
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

function update(n: number, depth: number): number[] {
  let xs = make(n);
  const saved: number[][] = [];
  xs = xs.map((value, index, source) => {
    if (index === 1) {
      if (depth > 0) check(update(n + 1000, depth - 1), n + 1100);
      assert.sameValue(source[0], n);
      saved.push(source);
    }
    return value + 100;
  });
  const witness = saved[0];
  churn(n);
  assert.sameValue(saved[0] === witness, true);
  assert.sameValue(saved[0] === xs, false);
  check(saved[0], n);
  return xs;
}
for (let n = 0; n < 240; n++) check(update(n, 2), n + 100);
