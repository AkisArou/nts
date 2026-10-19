/*---
description: A unique symbol constant keys an interface member that literals and classes implement.
features: [ts-symbols, ts-unique-symbol, ts-interfaces, ts-class]
---*/
const area: unique symbol = Symbol("area");
interface Shape {
  [area](): number;
}
class Square implements Shape {
  constructor(private side: number) {}
  [area](): number {
    return this.side ** 2;
  }
}
const triangle: Shape = { [area]: () => 6 };
const shapes: Shape[] = [new Square(3), triangle];
assert.sameValue(shapes.reduce((sum, s) => sum + s[area](), 0), 15);
