/*---
description: "every receives the currently captured thisArg and stops at its first false predicate through a replaced context captured by a closure."
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-closures, ts-this-parameter, ts-objects, ts-arrow-functions]
---*/
// every receives the currently captured thisArg and stops at its first false predicate; route: a replaced context captured by a closure.
// Node prints: callbacks-every-this-captured-let:ok
type EveryLimit = { maximum: number };
let context: EveryLimit = { maximum: 10 };
const items: number[] = [2, 7, 4], log: string[] = [];
const callback = function (this: EveryLimit, value: number, index: number, owner: number[]): boolean {
  log[log.length] = index + ":" + this.maximum + ":" + (owner === items);
  return value < this.maximum;
};
const test = (): boolean => items.every(callback, context);
assert.sameValue(test(), true);
assert.compareArray(log, ["0:10:true", "1:10:true", "2:10:true"]);
context = { maximum: 6 }; log.length = 0;
assert.sameValue(test(), false);
assert.compareArray(log, ["0:6:true", "1:6:true"]);
console.log("callbacks-every-this-captured-let:ok");
