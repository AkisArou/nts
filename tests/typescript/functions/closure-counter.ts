/*---
description: Closures capture a typed local by reference; each call of the factory makes a new local.
features: [ts-functions, ts-closures]
---*/
function counter(step: number): { next: () => number; reset: () => void } {
  let value = 0;
  return {
    next: () => (value += step),
    reset: () => {
      value = 0;
    },
  };
}
const byTwo = counter(2);
const byTen = counter(10);
byTwo.next();
assert.sameValue(byTwo.next(), 4);
assert.sameValue(byTen.next(), 10);
byTwo.reset();
assert.sameValue(byTwo.next(), 2);
