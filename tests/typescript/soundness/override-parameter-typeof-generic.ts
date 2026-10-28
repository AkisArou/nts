/*---
description: A generic constrained by the base class reaches a narrower override and preserves the string in its number-typed payload.
features: [ts-unsound-bivariance, ts-class, ts-inheritance, ts-override, ts-generics, ts-generic-constraints, ts-functions, ts-class-fields, ts-typeof-operator, ts-conversions, ts-unknown]
---*/
// TypeScript permits a narrower override parameter by method bivariance.
// Food's string payload violates Fish's number field; node keeps the string.
class Food { payload: unknown = "7"; }
class Fish extends Food { override payload: number = 2; }
let visits = 0;
class Animal { eat(food: Food): void { throw new Test262Error("base method ran"); } }
class Cat extends Animal {
  override eat(food: Fish): void {
    visits++;
    assert.sameValue(typeof food.payload, "string");
    assert.sameValue(String(food.payload + 1), "71");
  }
}
function deliver<T extends Animal>(feeder: T): void { feeder.eat(new Food()); }
deliver(new Cat());
assert.sameValue(visits, 1);
