/*---
description: A class index signature is erased; instances take any extra keys at run time.
features: [ts-class, ts-index-signatures]
---*/
class Bag {
  [key: string]: number | (() => number);
  count = 0;
  total(): number {
    let sum = 0;
    for (const key of Object.keys(this)) {
      const value = this[key];
      if (typeof value === "number") sum += value;
    }
    return sum;
  }
}
const bag = new Bag();
bag["apples"] = 3;
bag.pears = 4;
assert.sameValue(bag.total(), 7);
