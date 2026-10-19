/*---
description: A method decorator's addInitializer callback runs for each new instance, before field initialisers, with `this` the instance.
features: [ts-decorators, ts-class, ts-this]
---*/
const order: string[] = [];
function bound<This, Args extends unknown[], R>(_target: (this: This, ...args: Args) => R, context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => R>) {
  context.addInitializer(function (this: This) {
    order.push("initializer");
    const self = this as Record<string | symbol, unknown>;
    self[context.name] = (self[context.name] as (...args: Args) => R).bind(this);
  });
}
class Button {
  label = (order.push("field"), "ok");
  @bound
  click(): string {
    return this.label;
  }
}
const click = new Button().click;
assert.sameValue(click(), "ok");
assert.compareArray(order, ["initializer", "field"]);
