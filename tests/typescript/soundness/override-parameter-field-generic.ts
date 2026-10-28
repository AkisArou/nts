/*---
description: A generic constrained by the base class reaches a narrower override and preserves a missing Fish-only field as undefined.
features: [ts-unsound-bivariance, ts-class, ts-inheritance, ts-override, ts-generics, ts-generic-constraints, ts-functions, ts-class-fields, ts-null-undefined]
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
function deliver<T extends Animal>(feeder: T): void { feeder.eat(new Food()); }
deliver(new Cat());
assert.sameValue(visits, 1);
