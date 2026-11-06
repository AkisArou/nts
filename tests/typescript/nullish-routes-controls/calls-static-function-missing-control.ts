/*---
description: "An absent static callback skips a logged argument. Route: class static field (control)"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// An absent static callback skips a logged argument. Route: class static field. Node prints calls-static-function-missing:ok.
const log: string[] = [];
function arg(): number { log.push("arg"); return 1; }
class Events {
  static callback: ((n: number) => number) | undefined = undefined;
  static run(): number | undefined {
    const fn = this.callback; const result = fn === null || fn === undefined ? undefined : fn.call(this, arg());
    return result;
  }
}
assert.sameValue(Events.run(), undefined);
assert.compareArray(log, []);
console.log("calls-static-function-missing:ok");
