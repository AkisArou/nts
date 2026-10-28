/*---
description: A callback through a base-class receiver reaches a narrower override and preserves a missing Fish-only field as undefined.
features: [ts-unsound-bivariance, ts-class, ts-inheritance, ts-override, ts-functions, ts-function-types, ts-arrow-functions, ts-class-fields, ts-null-undefined]
---*/
// TypeScript permits a narrower override parameter by method bivariance.
// Food lacks Fish's required fins; node runs Cat.eat and reads undefined.
class Food {}
class Fish extends Food { fins: number = 2; }
let visits = 0;
class Animal { eat(food: Food): void { throw new Test262Error("base method ran"); } }
class Cat extends Animal {
  override eat(food: Fish): void {
    visits++;
    assert.sameValue<unknown>(food.fins, undefined);
  }
}
const feeder: Animal = new Cat();
function deliver(callback: (food: Food) => void): void { callback(new Food()); }
deliver((food) => feeder.eat(food));
assert.sameValue(visits, 1);
