/*---
description: "flatMap binds thisArg and appends each callback result in visit order through a static field holding the callback context. (control)"
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-this-parameter]
---*/
function localFlatMap<T, U, C>(items: T[], callback: (this: C, value: T, index: number, owner: T[]) => U[], context: C): U[] {
  const result: U[] = [];
  for (let index = 0; index < items.length; index++) {
    const values = callback.call(context, items[index], index, items);
    for (let inner = 0; inner < values.length; inner++) result[result.length] = values[inner];
  }
  return result;
}
// flatMap binds thisArg and appends each callback result in visit order; route: a static field holding the callback context.
// Node prints: callbacks-flatmap-this-static-field:ok
class FlatScale { static context: { factor: number } = { factor: 3 }; }
const items: number[] = [2, 5], log: string[] = [];
const callback = function (this: { factor: number }, value: number, index: number, owner: number[]): number[] {
  log[log.length] = index + ":" + value + ":" + this.factor + ":" + (owner === items);
  return [value * this.factor, index];
};
for (const factor of [3, -2]) {
  FlatScale.context = { factor }; log.length = 0;
  const result = localFlatMap(items, callback, FlatScale.context);
  assert.compareArray(result, factor === 3 ? [6, 0, 15, 1] : [-4, 0, -10, 1]);
  assert.compareArray(log, factor === 3 ? ["0:2:3:true", "1:5:3:true"] : ["0:2:-2:true", "1:5:-2:true"]);
  assert.sameValue(result === items, false); assert.compareArray(items, [2, 5]);
}
console.log("callbacks-flatmap-this-static-field:ok");
