/*---
description: "A static optional callback executes with a present function. Route: class static field"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// A static optional callback executes with a present function. Route: class static field. Node prints calls-static-function-present:ok.
class Events {
  static callback: ((n: number) => number) | undefined = n => n * 2;
  static run(value: number): number | undefined {
    const result = this.callback?.(value);
    return result;
  }
}
assert.sameValue(Events.run(6), 12);
console.log("calls-static-function-present:ok");
