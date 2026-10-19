/*---
description: "`+` with a string converts a class instance through its valueOf first (ToPrimitive, hint default)."
features: [ts-class, ts-to-primitive]
---*/
class Money {
  constructor(private cents: number) {}
  valueOf(): number {
    return this.cents;
  }
}
assert.sameValue(new Money(5) + "", "5");
assert.sameValue(`${new Money(5)}`, "[object Object]");
