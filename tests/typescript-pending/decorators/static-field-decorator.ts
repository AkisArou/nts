/*---
description: A decorator on a static field transforms the value once, when the class is defined.
features: [ts-decorators, ts-class, ts-static]
---*/
let runs = 0;
function frozen<T extends object>(_target: undefined, _context: ClassFieldDecoratorContext<unknown, T>) {
  return (initial: T): T => {
    runs++;
    return Object.freeze(initial);
  };
}
class Defaults {
  @frozen static options = { retries: 3 };
}
new Defaults();
new Defaults();
assert.sameValue(Object.isFrozen(Defaults.options), true);
assert.sameValue(Defaults.options.retries, 3);
assert.sameValue(runs, 1);
