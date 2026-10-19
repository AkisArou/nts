/*---
description: A parameter property marked `override` redeclares a base field; the subclass's value replaces the base's after super.
features: [ts-class, ts-parameter-properties, ts-override, ts-inheritance]
---*/
class Shape {
  sides = 0;
  seenByBase: number;
  constructor() {
    this.seenByBase = this.sides;
  }
}
class Polygon extends Shape {
  constructor(override readonly sides: number) {
    super();
  }
}
const pentagon = new Polygon(5);
assert.sameValue(pentagon.sides, 5);
assert.sameValue(pentagon.seenByBase, 0);
