/*---
description: A `declare` field emits nothing: the object has no such property until something assigns it.
features: [ts-class, ts-class-fields, ts-declare-field]
---*/
class Lazy {
  declare cached: number;
  plain = 1;
  fill(): void {
    this.cached = 9;
  }
}
const lazy = new Lazy();
assert.sameValue("cached" in lazy, false);
assert.sameValue(Object.keys(lazy).join(","), "plain");
lazy.fill();
assert.sameValue(lazy.cached, 9);
