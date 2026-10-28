/*---
description: A callback through a base-class receiver reaches a narrower override and preserves the string in its number-typed payload.
features: [ts-unsound-bivariance, ts-class, ts-inheritance, ts-override, ts-functions, ts-function-types, ts-arrow-functions, ts-class-fields, ts-typeof-operator, ts-conversions, ts-unknown]
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
const feeder: Animal = new Cat();
function deliver(callback: (food: Food) => void): void { callback(new Food()); }
deliver((food) => feeder.eat(food));
assert.sameValue(visits, 1);
