/*---
description: A subclass overrides an accessor pair and delegates to the base's through super.
features: [ts-class, ts-accessors, ts-inheritance]
---*/
class Field {
  protected raw = "";
  get value(): string {
    return this.raw;
  }
  set value(next: string) {
    this.raw = next;
  }
}
class TrimmedField extends Field {
  override get value(): string {
    return `<${super.value}>`;
  }
  override set value(next: string) {
    super.value = next.trim();
  }
}
const field: Field = new TrimmedField();
field.value = "  hi  ";
assert.sameValue(field.value, "<hi>");
