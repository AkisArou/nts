/*---
description: An awaited array keeps its identity across an immutable owner update.
features: [ts-lifetime-in-place, ts-route-await, ts-functions, ts-iteration, ts-arrays, ts-async]
flags: [async]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: an async local spans await; Node returns the original array from both reads of the promise.
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

async function hold(source: number[]): Promise<number[]> {
  await Promise.resolve();
  return source;
}
async function run(): Promise<void> {
  for (let n = 0; n < 240; n++) {
    let xs = make(n);
    const pending = hold(xs);
    xs = xs.map(value => value + 100);
    churn(n);
    const old = await pending;
    const witness = await pending;
    assert.sameValue(old === witness, true);
    assert.sameValue(old === xs, false);
    check(old, n); check(xs, n + 100);
  }
}
run().then(() => $DONE(), error => $DONE(error));
