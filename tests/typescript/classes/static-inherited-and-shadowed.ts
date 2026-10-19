/*---
description: A subclass reads a static field through its prototype chain until it assigns its own.
features: [ts-class, ts-static, ts-inheritance]
---*/
class Settings {
  static limit = 10;
}
class Strict extends Settings {}
assert.sameValue(Strict.limit, 10);
Strict.limit = 3;
assert.sameValue(Strict.limit, 3);
assert.sameValue(Settings.limit, 10);
assert.sameValue(Object.prototype.hasOwnProperty.call(Strict, "limit"), true);
