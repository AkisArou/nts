/*---
description: "forEach passes a readonly field receiver unchanged and visits every dense element through a declared readonly array field."
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-readonly, ts-arrow-functions]
---*/
// forEach passes a readonly field receiver unchanged and visits every dense element; route: a declared readonly array field.
// Node prints: callbacks-foreach-readonly-field:ok
class VisitShelf {
  readonly items: readonly string[];
  constructor(items: readonly string[]) { this.items = items; }
  run(): string[] {
    const log: string[] = [];
    const callback = (value: string, index: number, owner: readonly string[]): void => {
      log[log.length] = index + ":" + value + ":" + (owner === this.items);
    };
    this.items.forEach(callback);
    return log;
  }
}
assert.compareArray(new VisitShelf([]).run(), []);
assert.compareArray(new VisitShelf(["q"]).run(), ["0:q:true"]);
assert.compareArray(new VisitShelf(["red", "", "blue"]).run(), ["0:red:true", "1::true", "2:blue:true"]);
console.log("callbacks-foreach-readonly-field:ok");
