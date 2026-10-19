/*---
description: `+` with a string converts an object without its own valueOf through toString, because Object.prototype.valueOf returns the object.
features: [ts-conversions, ts-to-string, ts-class]
---*/
class Tag {
  constructor(private label: string) {}
  toString(): string {
    return `<${this.label}>`;
  }
}
class Plain {}
assert.sameValue(new Tag("b") + "", "<b>");
assert.sameValue("x" + new Tag("i"), "x<i>");
assert.sameValue(new Plain() + "", "[object Object]");
