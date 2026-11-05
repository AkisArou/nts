/*---
description: "forEach uses the current captured receiver and returns undefined after all visits through a reassigned let captured by a closure."
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-closures, ts-arrow-functions, ts-null-undefined]
---*/
// forEach uses the current captured receiver and returns undefined after all visits; route: a reassigned let captured by a closure.
// Node prints: callbacks-foreach-captured-let:ok
let items: number[] = [4, 9];
const log: string[] = [];
const visit = (): void => {
  const callback = (value: number, index: number, owner: number[]): void => {
    log[log.length] = index + ":" + value + ":" + (owner === items);
  };
  const result = items.forEach(callback);
  assert.sameValue(result, undefined);
};
visit(); items = []; visit(); items = [2, 7, 1]; visit();
assert.compareArray(log, ["0:4:true", "1:9:true", "0:2:true", "1:7:true", "2:1:true"]);
assert.compareArray(items, [2, 7, 1]);
console.log("callbacks-foreach-captured-let:ok");
