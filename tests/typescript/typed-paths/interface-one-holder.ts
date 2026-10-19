/*---
description: A call through an interface reaches its one implementing class.
features: [ts-interfaces, ts-class]
---*/
interface Shape {
  area(): number;
}
class Square implements Shape {
  constructor(private side: number) {}
  area(): number {
    return this.side * this.side;
  }
}
const shape: Shape = new Square(3);
assert.sameValue(shape.area(), 9);
