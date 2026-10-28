// expect: this module-scope statement was dropped because it calls `Feeder#eat`, which was refused above
// One-difference control: the call receiver is Animal instead of Feeder.
class Food { kind(): string { return "food"; } }
class Fish extends Food { fins: number = 2; override kind(): string { return "fish"; } }
class Animal { eat(food: Food): string { return food.kind(); } }
class Cat extends Animal { override eat(food: Fish): string { return food.kind(); } }
interface Feeder { eat(food: Food): string; }
const feeder: Feeder = new Cat();
feeder.eat(new Food());
export function kept(n: number): number { return n + 1; }
