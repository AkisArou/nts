/*---
description: A class exported from a namespace is constructed through the namespace's name.
features: [ts-namespace, ts-class]
---*/
namespace Shapes {
  export class Circle {
    constructor(public radius: number) {}
    diameter(): number {
      return this.radius * 2;
    }
  }
}
const circle = new Shapes.Circle(3);
assert.sameValue(circle.diameter(), 6);
assert.sameValue(circle instanceof Shapes.Circle, true);
