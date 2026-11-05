/*---
description: "reduce with an initial value starts at index zero and returns the initial value for an empty source through a private array field. (control)"
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-private-fields, ts-arrow-functions]
---*/
function localReduce<T, U>(items: T[], callback: (accumulator: U, value: T, index: number, owner: T[]) => U, initial: U): U {
  let accumulator = initial;
  for (let index = 0; index < items.length; index++) accumulator = callback(accumulator, items[index], index, items);
  return accumulator;
}
// reduce with an initial value starts at index zero and returns the initial value for an empty source; route: a private array field.
// Node prints: callbacks-reduce-initial-private-field:ok
class SumShelf {
  #items: number[];
  constructor(items: number[]) { this.#items = items; }
  run(expected: number, visits: string[]): void {
    const log: string[] = [];
    const callback = (sum: number, value: number, index: number, owner: number[]): number => {
      log[log.length] = index + ":" + sum + ":" + value + ":" + (owner === this.#items);
      return sum + value;
    };
    const result = localReduce(this.#items, callback, 10);
    assert.sameValue(result, expected); assert.compareArray(log, visits);
  }
}
new SumShelf([]).run(10, []);
new SumShelf([4]).run(14, ["0:10:4:true"]);
new SumShelf([2, 5, 7]).run(24, ["0:10:2:true", "1:12:5:true", "2:17:7:true"]);
console.log("callbacks-reduce-initial-private-field:ok");
