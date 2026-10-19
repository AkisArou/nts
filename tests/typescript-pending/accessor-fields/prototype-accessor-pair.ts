/*---
description: An `accessor` field is a getter and setter pair on the prototype over private storage; the instance has no own property.
features: [ts-accessor-fields, ts-class, ts-accessors]
---*/
class Box {
  accessor width = 2;
}
const box = new Box();
assert.sameValue(box.width, 2);
box.width = 5;
assert.sameValue(box.width, 5);
assert.sameValue(Object.keys(box).length, 0);
const descriptor = Object.getOwnPropertyDescriptor(Box.prototype, "width");
assert.sameValue(typeof descriptor?.get, "function");
assert.sameValue(typeof descriptor?.set, "function");
