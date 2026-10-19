/*---
description: A subclass overrides an inherited `accessor` with its own getter and setter, which may reach the base's through super.
features: [ts-accessor-fields, ts-class, ts-inheritance, ts-accessors]
---*/
class Base {
  accessor label = "base";
}
class Loud extends Base {
  override get label(): string {
    return super.label.toUpperCase();
  }
  override set label(value: string) {
    super.label = `${value}!`;
  }
}
const loud = new Loud();
assert.sameValue(loud.label, "BASE");
loud.label = "hey";
assert.sameValue(loud.label, "HEY!");
