/*---
description: A method in an object literal reaches its prototype's method through super.
features: [ts-objects, ts-inheritance]
---*/
const base = {
  greet(): string {
    return "hello";
  },
};
const derived = {
  __proto__: base,
  greet(): string {
    return `${super.greet()} world`;
  },
};
assert.sameValue(derived.greet(), "hello world");
assert.sameValue(Object.getPrototypeOf(derived), base);
