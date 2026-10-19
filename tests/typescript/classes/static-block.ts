/*---
description: A static block runs once, after the static fields before it.
features: [ts-class, ts-class-static-block]
---*/
class Registry {
  static count = 2;
  static {
    Registry.count *= 3;
  }
}
assert.sameValue(Registry.count, 6);
