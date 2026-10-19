/*---
description: A method decorator returns a replacement method, which the class installs and every instance calls.
features: [ts-decorators, ts-class]
---*/
const calls: string[] = [];
function logged<This, Args extends unknown[], R>(target: (this: This, ...args: Args) => R, context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => R>) {
  return function (this: This, ...args: Args): R {
    calls.push(`${String(context.name)}(${args.join(",")})`);
    return target.call(this, ...args);
  };
}
class Calculator {
  constructor(private base: number) {}
  @logged
  add(a: number, b: number): number {
    return this.base + a + b;
  }
}
const calculator = new Calculator(10);
assert.sameValue(calculator.add(1, 2), 13);
assert.sameValue(calculator.add(3, 4), 17);
assert.compareArray(calls, ["add(1,2)", "add(3,4)"]);
