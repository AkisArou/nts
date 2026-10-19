/*---
description: An object literal is assigned to a class type with only public members; it is not an instance of the class.
features: [ts-objects, ts-structural-typing, ts-class]
---*/
class Money {
  constructor(public amount: number, public currency: string) {}
}
function format(money: Money): string {
  return `${money.amount.toFixed(2)} ${money.currency}`;
}
const literal: Money = { amount: 3, currency: "EUR" };
assert.sameValue(format(literal), "3.00 EUR");
assert.sameValue(format(new Money(1.5, "USD")), "1.50 USD");
assert.sameValue(literal instanceof Money, false);
