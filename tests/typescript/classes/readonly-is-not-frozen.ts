/*---
description: `readonly` is a compile-time check only; the field is an ordinary writable property.
features: [ts-class, ts-readonly]
---*/
class Frozenish {
  readonly value = 1;
}
const object = new Frozenish();
const descriptor = Object.getOwnPropertyDescriptor(object, "value");
assert.sameValue(descriptor?.writable, true);
assert.sameValue(Object.isFrozen(object), false);
(object as { value: number }).value = 2;
assert.sameValue(object.value, 2);
