/*---
description: A subclass overrides a generic method, and calls through the base type reach the override at each instantiation.
features: [ts-generics, ts-class, ts-inheritance, ts-override]
---*/
class Formatter {
  format<T>(value: T): string {
    return String(value);
  }
}
class Bracketed extends Formatter {
  override format<T>(value: T): string {
    return `[${super.format(value)}]`;
  }
}
const formatter: Formatter = new Bracketed();
assert.sameValue(formatter.format(3), "[3]");
assert.sameValue(formatter.format("x"), "[x]");
assert.sameValue(formatter.format([1, 2]), "[1,2]");
