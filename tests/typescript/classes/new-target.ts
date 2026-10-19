/*---
description: In a base constructor, new.target is the class actually being constructed.
features: [ts-class, ts-inheritance, ts-new-target]
---*/
class Shape {
  readonly made: string;
  constructor() {
    this.made = new.target.name;
  }
}
class Circle extends Shape {}
assert.sameValue(new Shape().made, "Shape");
assert.sameValue(new Circle().made, "Circle");
