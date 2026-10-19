/*---
description: A subclass overrides a method and reaches the base's version through super.
features: [ts-class, ts-inheritance, ts-override]
---*/
class Greeter {
  greet(who: string): string {
    return `hello ${who}`;
  }
}
class LoudGreeter extends Greeter {
  override greet(who: string): string {
    return super.greet(who).toUpperCase() + "!";
  }
}
const greeter: Greeter = new LoudGreeter();
assert.sameValue(greeter.greet("ann"), "HELLO ANN!");
assert.sameValue(new Greeter().greet("bo"), "hello bo");
