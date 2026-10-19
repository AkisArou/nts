/*---
description: Static getters and setters run on the class itself.
features: [ts-class, ts-accessors, ts-static]
---*/
class Volume {
  static #level = 5;
  static get level(): number {
    return Volume.#level;
  }
  static set level(next: number) {
    Volume.#level = Math.min(10, Math.max(0, next));
  }
}
Volume.level = 12;
assert.sameValue(Volume.level, 10);
Volume.level = -3;
assert.sameValue(Volume.level, 0);
