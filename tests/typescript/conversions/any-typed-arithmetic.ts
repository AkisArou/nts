/*---
description: Through an `any`-typed operand, `*`, binary `-`, `>` and `+` with a number convert an object by valueOf.
features: [ts-conversions, ts-to-primitive, ts-any]
---*/
class Money {
  constructor(private cents: number) {}
  valueOf(): number {
    return this.cents;
  }
}
const price: any = new Money(250);
const tax: any = new Money(50);
assert.sameValue(price * 2, 500);
assert.sameValue(price - tax, 200);
assert.sameValue(price > 100, true);
assert.sameValue(price + 1, 251);
assert.sameValue(price + tax, 300);
