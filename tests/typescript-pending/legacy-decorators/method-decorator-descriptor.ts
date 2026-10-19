/*---
description: A legacy method decorator receives the prototype, the key and the descriptor, and its replaced descriptor is installed.
features: [ts-legacy-decorators, ts-class]
---*/
const calls: string[] = [];
function logged(target: object, key: string, descriptor: PropertyDescriptor): PropertyDescriptor {
  const original = descriptor.value as (...args: number[]) => number;
  calls.push(`decorated ${key} on ${target.constructor.name}`);
  return {
    ...descriptor,
    value(this: unknown, ...args: number[]): number {
      calls.push(`call ${key}`);
      return original.apply(this, args);
    },
  };
}
class Maths {
  @logged
  square(n: number): number {
    return n * n;
  }
}
assert.sameValue(new Maths().square(4), 16);
assert.compareArray(calls, ["decorated square on Maths", "call square"]);
assert.sameValue(Object.getOwnPropertyDescriptor(Maths.prototype, "square")?.enumerable, false);
