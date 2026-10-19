/*---
description: Getter and setter decorators each replace their own half of an accessor pair.
features: [ts-decorators, ts-class, ts-accessors]
---*/
function upper<This>(target: (this: This) => string, _context: ClassGetterDecoratorContext<This, string>) {
  return function (this: This): string {
    return target.call(this).toUpperCase();
  };
}
function trimmed<This>(target: (this: This, value: string) => void, _context: ClassSetterDecoratorContext<This, string>) {
  return function (this: This, value: string): void {
    target.call(this, value.trim());
  };
}
class Label {
  #text = "";
  @upper
  get text(): string {
    return this.#text;
  }
  @trimmed
  set text(value: string) {
    this.#text = value;
  }
}
const label = new Label();
label.text = "  hello  ";
assert.sameValue(label.text, "HELLO");
