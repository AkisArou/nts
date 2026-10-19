/*---
description: A derived class's parameter property is declared with its fields and assigned after super returns.
features: [ts-class, ts-parameter-properties, ts-class-fields, ts-inheritance]
---*/
class Base {
  base = 1;
  constructor() {}
}
class Derived extends Base {
  extra = 2;
  constructor(public param: number) {
    super();
  }
}
const derived = new Derived(3);
assert.sameValue(Object.keys(derived).join(","), "base,param,extra");
assert.sameValue(derived.param + derived.extra + derived.base, 6);
