/*---
description: "filter uses the supplied thisArg and retains the selected values in order through a private field holding the callback context."
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-private-fields, ts-this-parameter]
---*/
// filter uses the supplied thisArg and retains the selected values in order; route: a private field holding the callback context.
// Node prints: callbacks-filter-this-private-field:ok
type FilterLimit = { minimum: number };
const items: number[] = [9, 2, 7, 4];
class LimitHolder {
  #limit: FilterLimit;
  constructor(minimum: number) { this.#limit = { minimum }; }
  run(expected: number[], visits: string[]): void {
    const log: string[] = [];
    const callback = function (this: FilterLimit, value: number, index: number, owner: number[]): boolean {
      log[log.length] = index + ":" + this.minimum + ":" + (owner === items);
      return value >= this.minimum;
    };
    const result = items.filter(callback, this.#limit);
    assert.compareArray(result, expected); assert.compareArray(log, visits);
    assert.sameValue(result === items, false); assert.compareArray(items, [9, 2, 7, 4]);
  }
}
new LimitHolder(7).run([9, 7], ["0:7:true", "1:7:true", "2:7:true", "3:7:true"]);
new LimitHolder(4).run([9, 7, 4], ["0:4:true", "1:4:true", "2:4:true", "3:4:true"]);
console.log("callbacks-filter-this-private-field:ok");
