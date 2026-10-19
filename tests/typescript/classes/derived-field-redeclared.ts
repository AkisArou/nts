/*---
description: A field redeclared by a subclass shows the base's value inside the base constructor and the subclass's afterwards.
features: [ts-class, ts-class-fields, ts-inheritance]
---*/
class Base {
  color = "red";
  seen: string;
  constructor() {
    this.seen = this.color;
  }
}
class Derived extends Base {
  override color = "blue";
}
const derived = new Derived();
assert.sameValue(derived.seen, "red");
assert.sameValue(derived.color, "blue");
