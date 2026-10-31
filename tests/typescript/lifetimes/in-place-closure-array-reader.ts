/*---
description: A delayed closure observes the old array after an immutable replacement.
features: [ts-lifetime-in-place, ts-route-closure, ts-functions, ts-iteration, ts-arrays, ts-closures]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: a stored reader captures the source; Node preserves all three entries and its identity.
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

function save(n: number): () => number[] {
  let xs = make(n);
  const snapshot = xs;
  const read = (): number[] => snapshot;
  xs = xs.map(value => value + 100);
  check(xs, n + 100);
  return read;
}
for (let n = 0; n < 240; n++) {
  const read = save(n);
  const witness = read();
  churn(n);
  const kept = read();
  assert.sameValue(kept === witness, true);
  check(kept, n);
}
