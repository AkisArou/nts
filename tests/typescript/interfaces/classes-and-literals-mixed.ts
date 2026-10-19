/*---
description: One array of an interface type holds class instances and object literals; each call dispatches to its own method.
features: [ts-interfaces, ts-class, ts-structural-typing]
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
const triangle: Shape = { area: () => 6 };
const circleish = {
  radius: 1,
  area(): number {
    return 3 * this.radius * this.radius;
  },
};
const shapes: Shape[] = [new Square(2), triangle, circleish, new Square(3)];
assert.sameValue(shapes.map((s) => s.area()).join(","), "4,6,3,9");
