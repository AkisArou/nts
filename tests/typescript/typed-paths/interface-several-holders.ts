/*---
description: A call through an interface dispatches on the value's own class.
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
class Rect implements Shape {
  constructor(private w: number, private h: number) {}
  area(): number {
    return this.w * this.h;
  }
}
const shapes: Shape[] = [new Square(2), new Rect(2, 3), new Square(1)];
let sum = 0;
for (const shape of shapes) sum += shape.area();
assert.sameValue(sum, 11);
