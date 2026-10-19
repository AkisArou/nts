/*---
description: A generic sum constrained to `{ valueOf(): number }` adds numbers, classes and literals through unary plus.
features: [ts-conversions, ts-to-primitive, ts-generics, ts-generic-constraints, ts-interfaces, ts-class]
---*/
interface NumberLike {
  valueOf(): number;
}
function sum<T extends NumberLike>(items: T[]): number {
  return items.reduce((total, item) => total + +item, 0);
}
class Weight implements NumberLike {
  constructor(private grams: number) {}
  valueOf(): number {
    return this.grams;
  }
}
const literal: NumberLike = { valueOf: () => 0.5 };
assert.sameValue(sum([1, 2, 3]), 6);
assert.sameValue(sum([new Weight(100), new Weight(250)]), 350);
assert.sameValue(sum<NumberLike>([new Weight(1), literal, 2]), 3.5);
