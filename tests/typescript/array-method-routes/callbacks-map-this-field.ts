/*---
description: "map forwards thisArg into a declared-this function while retaining value, index and receiver through a class field holding the callback context."
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-this-parameter, ts-function-types]
---*/
// map forwards thisArg into a declared-this function while retaining value, index and receiver; route: a class field holding the callback context.
// Node prints: callbacks-map-this-field:ok
class Scale { factor: number; constructor(factor: number) { this.factor = factor; } }
class ScaleHolder { context: Scale; constructor(factor: number) { this.context = new Scale(factor); } }
const items: number[] = [2, 5], log: string[] = [];
const callback = function (this: Scale, value: number, index: number, owner: number[]): number {
  log[log.length] = index + ":" + value + ":" + this.factor + ":" + (owner === items);
  return value * this.factor;
};
for (const holder of [new ScaleHolder(3), new ScaleHolder(-2)]) {
  log.length = 0;
  const result = items.map(callback, holder.context);
  assert.compareArray(result, holder.context.factor === 3 ? [6, 15] : [-4, -10]);
  assert.compareArray(log, holder.context.factor === 3 ? ["0:2:3:true", "1:5:3:true"] : ["0:2:-2:true", "1:5:-2:true"]);
  assert.sameValue(result === items, false); assert.compareArray(items, [2, 5]);
}
console.log("callbacks-map-this-field:ok");
