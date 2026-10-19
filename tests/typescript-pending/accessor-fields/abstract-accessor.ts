/*---
description: An `abstract accessor` declares an accessor that a subclass implements with an `accessor` field of its own.
features: [ts-accessor-fields, ts-class, ts-abstract]
---*/
abstract class Shape {
  abstract accessor sides: number;
  describe(): string {
    return `${this.sides} sides`;
  }
}
class Triangle extends Shape {
  accessor sides = 3;
}
const triangle: Shape = new Triangle();
assert.sameValue(triangle.describe(), "3 sides");
triangle.sides = 4;
assert.sameValue(triangle.describe(), "4 sides");
