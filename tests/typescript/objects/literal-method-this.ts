/*---
description: A method in an object literal sees the literal as `this`, typed by the literal itself.
features: [ts-objects, ts-this]
---*/
const cart = {
  items: [3, 4],
  discount: 1,
  total(): number {
    return this.items.reduce((a, b) => a + b, 0) - this.discount;
  },
  add(item: number) {
    this.items.push(item);
    return this;
  },
};
assert.sameValue(cart.add(5).total(), 11);
