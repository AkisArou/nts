/*---
description: A decorator on an `accessor` field returns get, set and init replacements for the generated accessor.
features: [ts-decorators, ts-accessor-fields, ts-class]
---*/
const writes: number[] = [];
function clamped<This>(target: ClassAccessorDecoratorTarget<This, number>, _context: ClassAccessorDecoratorContext<This, number>): ClassAccessorDecoratorResult<This, number> {
  return {
    get(this: This): number {
      return target.get.call(this);
    },
    set(this: This, value: number): void {
      writes.push(value);
      target.set.call(this, Math.min(100, Math.max(0, value)));
    },
    init(initial: number): number {
      return Math.min(100, initial);
    },
  };
}
class Gauge {
  @clamped accessor level = 250;
}
const gauge = new Gauge();
assert.sameValue(gauge.level, 100);
gauge.level = -5;
assert.sameValue(gauge.level, 0);
assert.compareArray(writes, [-5]);
