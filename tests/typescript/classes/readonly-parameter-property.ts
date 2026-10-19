/*---
description: A readonly parameter property is a field set once, by the constructor.
features: [ts-parameter-properties, ts-class]
---*/
class Tag {
  constructor(readonly name: string) {}
}
assert.sameValue(new Tag("x").name, "x");
