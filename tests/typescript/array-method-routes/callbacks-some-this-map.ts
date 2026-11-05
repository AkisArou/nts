/*---
description: "some applies thisArg at every visit and stops when that context admits a value through callback contexts read from a typed Map."
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-map-set, ts-this-parameter, ts-objects]
---*/
// some applies thisArg at every visit and stops when that context admits a value; route: callback contexts read from a typed Map.
// Node prints: callbacks-some-this-map:ok
type SomeLimit = { minimum: number };
const contexts: Map<string, SomeLimit> = new Map([["near", { minimum: 7 }], ["far", { minimum: 20 }]]);
const items: number[] = [3, 8, 14];
for (const key of ["near", "far"]) {
  const context = contexts.get(key); if (context === undefined) throw new Error("missing context");
  const log: string[] = [];
  const callback = function (this: SomeLimit, value: number, index: number, owner: number[]): boolean {
    log[log.length] = index + ":" + value + ":" + this.minimum + ":" + (owner === items);
    return value > this.minimum;
  };
  const result = items.some(callback, context);
  assert.sameValue(result, key === "near");
  assert.compareArray(log, key === "near" ? ["0:3:7:true", "1:8:7:true"] : ["0:3:20:true", "1:8:20:true", "2:14:20:true"]);
}
console.log("callbacks-some-this-map:ok");
