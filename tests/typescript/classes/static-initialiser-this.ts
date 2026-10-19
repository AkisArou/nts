/*---
description: In a static field initialiser, `this` is the class, and earlier static fields are already set.
features: [ts-class, ts-static, ts-class-fields]
---*/
class Defaults {
  static base = 4;
  static doubled = this.base * 2;
  static self = this;
}
assert.sameValue(Defaults.doubled, 8);
assert.sameValue(Defaults.self, Defaults);
