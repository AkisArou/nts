/*---
description: Unary minus and bitwise not convert an object through valueOf, then apply to the number.
features: [ts-conversions, ts-to-primitive, ts-class]
---*/
class Count {
  constructor(private n: number) {}
  valueOf(): number {
    return this.n;
  }
}
const five = new Count(5);
assert.sameValue(-five, -5);
assert.sameValue(~five, -6);
assert.sameValue(-new Count(2.5), -2.5);
assert.sameValue(~new Count(2.5), -3);
