/*---
description: "A private optional function field calls its callback when populated. Route: class private field"
features: [ts-nullish-routes, ts-nullish-route-calls, ts-null-undefined, ts-optional-chaining]
---*/

// A private optional function field calls its callback when populated. Route: class private field. Node prints calls-private-function-present:ok.
const log: string[] = [];
class Handler {
  #onChange: ((value: number) => number) | undefined;
  constructor() { this.#onChange = value => { log.push("call"); return value + 2; }; }
  update(value: number): number | undefined {
    const result = this.#onChange?.(value);
    return result;
  }
}
assert.sameValue(new Handler().update(6), 8);
assert.compareArray(log, ["call"]);
console.log("calls-private-function-present:ok");
