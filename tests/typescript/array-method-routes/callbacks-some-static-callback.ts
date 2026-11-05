/*---
description: "some passes the receiver into a stored callback and stops at its first true result through a declared static callback field."
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-function-types, ts-arrow-functions]
---*/
// some passes the receiver into a stored callback and stops at its first true result; route: a declared static callback field.
// Node prints: callbacks-some-static-callback:ok
const items: number[] = [3, 8, 14], log: string[] = [];
class SomeRule {
  static threshold: number = 7;
  static callback: (value: number, index: number, owner: number[]) => boolean = (value, index, owner) => {
    log[log.length] = index + ":" + value + ":" + (owner === items);
    return value > SomeRule.threshold;
  };
}
for (const limit of [7, 20]) {
  SomeRule.threshold = limit; log.length = 0;
  const result = items.some(SomeRule.callback);
  assert.sameValue(result, limit === 7);
  assert.compareArray(log, limit === 7 ? ["0:3:true", "1:8:true"] : ["0:3:true", "1:8:true", "2:14:true"]);
  assert.compareArray(items, [3, 8, 14]);
}
console.log("callbacks-some-static-callback:ok");
