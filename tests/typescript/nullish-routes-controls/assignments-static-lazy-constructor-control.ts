/*---
description: "Static nullish lazy initialization constructs only one instance. Route: static field (control)"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// Static nullish lazy initialization constructs only one instance. Route: static field. Node prints assignments-static-lazy-constructor:ok.
const log: string[] = [];
class Registry {
  private static instance: Registry | undefined;
  constructor() { log.push("new"); }
  static get(): Registry {
    const saved = this.instance; let result: Registry;
if (saved === null || saved === undefined) { const next = new Registry(); this.instance = next; result = next; } else result = saved;
    return result;
  }
}
const first = Registry.get(), second = Registry.get();
assert.sameValue(first === second, true);
assert.compareArray(log, ["new"]);
console.log("assignments-static-lazy-constructor:ok");
