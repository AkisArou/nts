/*---
description: "An unset private optional callback skips its argument. Route: class private field"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// An unset private optional callback skips its argument. Route: class private field. Node prints calls-private-function-missing:ok.
const log: string[] = [];
function arg(): number { log.push("arg"); return 1; }
class Handler {
  #onChange: ((value: number) => number) | undefined;
  constructor() { this.#onChange = undefined; }
  update(): number | undefined {
    const result = this.#onChange?.(arg());
    return result;
  }
}
assert.sameValue(new Handler().update(), undefined);
assert.compareArray(log, []);
console.log("calls-private-function-missing:ok");
