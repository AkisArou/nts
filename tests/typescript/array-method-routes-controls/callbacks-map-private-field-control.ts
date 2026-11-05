/*---
description: "map visits dense empty, single and longer receivers in order through a private array field. (control)"
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-private-fields, ts-arrow-functions]
---*/
function localMap<T, U>(items: T[], callback: (value: T, index: number, owner: T[]) => U): U[] {
  const result: U[] = [];
  for (let index = 0; index < items.length; index++) result[index] = callback(items[index], index, items);
  return result;
}
// map visits dense empty, single and longer receivers in order; route: a private array field.
// Node prints: callbacks-map-private-field:ok
class MappedItems {
  #items: number[];
  constructor(items: number[]) { this.#items = items; }
  run(expected: number[], visits: string[]): void {
    const log: string[] = [];
    const callback = (value: number, index: number, owner: number[]): number => {
      log[log.length] = index + ":" + value + ":" + (owner === this.#items);
      return value * 3 + index;
    };
    const result = localMap(this.#items, callback);
    assert.compareArray(result, expected); assert.compareArray(log, visits);
    assert.sameValue(result === this.#items, false);
  }
}
new MappedItems([]).run([], []);
new MappedItems([4]).run([12], ["0:4:true"]);
new MappedItems([3, 1, 8]).run([9, 4, 26], ["0:3:true", "1:1:true", "2:8:true"]);
console.log("callbacks-map-private-field:ok");
