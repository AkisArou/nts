/*---
description: A private generic field keeps a string written through a wider literal-key alias.
features: [ts-unsound-private, ts-class, ts-class-fields, ts-typeof-operator, ts-conversions, ts-private-keyword, ts-generics, ts-unsound-covariant-view]
---*/
// TypeScript permits Box<number> to widen and literal-key access to private.
// The wider write breaks the number claim; node reads the stored string.
class Box<T> {
  private value: T;
  constructor(value: T) { this.value = value; }
}
const box = new Box<number>(2);
const wide: Box<unknown> = box;
wide["value"] = "7";
const value: number = box["value"];
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
assert.sameValue(value === 7, false);
