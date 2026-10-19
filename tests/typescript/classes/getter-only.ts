/*---
description: A getter with no setter computes on every read and is an accessor without a set function.
features: [ts-class, ts-accessors]
---*/
class Rectangle {
  constructor(public width: number, public height: number) {}
  get area(): number {
    return this.width * this.height;
  }
}
const rect = new Rectangle(2, 3);
assert.sameValue(rect.area, 6);
rect.width = 5;
assert.sameValue(rect.area, 15);
const descriptor = Object.getOwnPropertyDescriptor(Rectangle.prototype, "area");
assert.sameValue(descriptor?.set, undefined);
assert.sameValue(typeof descriptor?.get, "function");
