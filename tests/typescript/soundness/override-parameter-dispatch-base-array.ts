/*---
description: An array of base-class receivers reaches a narrower override and preserves method dispatch by the actual Food class.
features: [ts-unsound-bivariance, ts-class, ts-inheritance, ts-override, ts-arrays, ts-functions, ts-class-fields]
---*/
// TypeScript permits a narrower override parameter by method bivariance.
// Fish's required fins makes it narrower; node dispatches Food.kind in Cat.eat.
class Food { kind(): string { return "food"; } }
class Fish extends Food { fins: number = 2; override kind(): string { return "fish"; } }
let visits = 0;
class Animal { eat(food: Food): void { throw new Test262Error("base method ran"); } }
class Cat extends Animal {
  override eat(food: Fish): void {
    visits++;
    assert.sameValue(food.kind(), "food");
  }
}
const feeders: Animal[] = [new Cat()];
feeders[0].eat(new Food());
assert.sameValue(visits, 1);
