/*---
description: A map that throws after its first result leaves the source array unchanged.
features: [ts-lifetime-in-place, ts-route-throw, ts-functions, ts-iteration, ts-arrays, ts-errors, ts-class, ts-unknown, ts-narrowing]
---*/
// Fact: unique storage may be reused (docs/foundations/memory.md, The ladder of homes).
// Route: the thrown payload exposes the source; Node keeps the original array and all its entries.
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

class Stop { source: number[]; constructor(source: number[]) { this.source = source; } }
for (let n = 0; n < 240; n++) {
  let xs = make(n);
  let caught = false;
  try {
    xs = xs.map((value, index, source) => {
      if (index === 1) throw new Stop(source);
      return value + 100;
    });
  } catch (error: unknown) {
    if (!(error instanceof Stop)) throw error;
    caught = true;
    churn(n);
    assert.sameValue(xs === error.source, true);
    check(xs, n); check(error.source, n);
  }
  assert.sameValue(caught, true);
}
