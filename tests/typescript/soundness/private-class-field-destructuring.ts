/*---
description: Destructuring inside a class preserves a private field polluted through a wider alias.
features: [ts-unsound-private, ts-class, ts-class-fields, ts-typeof-operator, ts-conversions, ts-destructuring, ts-private-keyword, ts-generics, ts-unsound-covariant-view]
---*/
// TypeScript permits a covariant generic alias to bracket-write a private field.
// The original number view is false; node destructures the actual string.
class Box<T> {
  private value: T;
  constructor(value: T) { this.value = value; }
  read(): T {
    const { value } = this;
    return value;
  }
}
const box = new Box<number>(2);
const wide: Box<unknown> = box;
wide["value"] = "7";
const value: number = box.read();
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
