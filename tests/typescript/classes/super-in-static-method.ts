/*---
description: super in a static method reaches the base class's static members.
features: [ts-class, ts-static, ts-inheritance]
---*/
class Base {
  static describe(): string {
    return "base";
  }
  static unit = 2;
}
class Derived extends Base {
  static override describe(): string {
    return `derived of ${super.describe()} x${super.unit}`;
  }
}
assert.sameValue(Derived.describe(), "derived of base x2");
