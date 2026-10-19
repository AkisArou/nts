/*---
description: A field decorator returns an initialiser that transforms the field's initial value for each instance.
features: [ts-decorators, ts-class, ts-class-fields]
---*/
function doubled<This>(_target: undefined, context: ClassFieldDecoratorContext<This, number>) {
  return function (this: This, initial: number): number {
    return initial * 2;
  };
}
class Settings {
  @doubled
  limit = 21;
  @doubled
  other = 0.5;
}
const settings = new Settings();
assert.sameValue(settings.limit, 42);
assert.sameValue(settings.other, 1);
assert.sameValue(Object.keys(settings).join(","), "limit,other");
