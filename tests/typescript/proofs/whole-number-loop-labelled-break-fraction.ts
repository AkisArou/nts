/*---
description: A labelled exit retains the fractional update made in the inner loop.
features: [ts-proof-whole-number, ts-route-loop, ts-functions, ts-iteration, ts-numbers]
---*/
// Fact: the initial seven is a whole int32 (docs/foundations/numbers.md, Integers proved from doubles).
// Route: the labelled edge leaves after division; node returns 3.5, or untouched 7.
function afterBreak(stop: number): number {
  let value = 7;
  outer: for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      if (row * 3 + column === stop) {
        value /= 2;
        break outer;
      }
    }
  }
  return value;
}

for (const n of [0, 1, 3, 4, 7, 9]) {
  assert.sameValue(afterBreak(n), n < 9 ? 3.5 : 7);
}
