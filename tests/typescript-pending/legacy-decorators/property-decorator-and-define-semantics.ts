/*---
description: An accessor a legacy property decorator puts on the prototype is shadowed by the field, which define semantics makes an own property.
features: [ts-legacy-decorators, ts-class, ts-class-fields]
---*/
const writes: string[] = [];
function observed(target: object, key: string): void {
  Object.defineProperty(target, key, {
    set(value: string) {
      writes.push(value);
    },
    get() {
      return "from accessor";
    },
    configurable: true,
  });
}
class Model {
  @observed title = "initial";
}
const model = new Model();
model.title = "changed";
assert.sameValue(model.title, "changed");
assert.sameValue(writes.length, 0);
assert.sameValue(Object.prototype.hasOwnProperty.call(model, "title"), true);
