/*---
description: A base constructor that reads an abstract property through a method sees undefined, because the subclass's field is defined after super returns.
features: [ts-class, ts-abstract, ts-class-fields, ts-inheritance]
---*/
abstract class Base {
  abstract readonly label: string;
  seenInConstructor: string;
  constructor() {
    this.seenInConstructor = this.readLabel();
  }
  readLabel(): string {
    return this.label;
  }
}
class Derived extends Base {
  readonly label = "derived";
}
const derived = new Derived();
assert.sameValue(derived.seenInConstructor, undefined);
assert.sameValue(derived.readLabel(), "derived");
