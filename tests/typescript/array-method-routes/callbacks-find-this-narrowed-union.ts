/*---
description: "find binds thisArg before its discriminant selects the predicate branch through a callback context narrowed by a discriminant."
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-unions, ts-narrowing, ts-type-aliases, ts-this-parameter]
---*/
// find binds thisArg before its discriminant selects the predicate branch; route: a callback context narrowed by a discriminant.
// Node prints: callbacks-find-this-narrowed-union:ok
type FindRule = { kind: "above"; minimum: number } | { kind: "below"; maximum: number };
const items: number[] = [5, 12, 8, 20];
function run(context: FindRule, expected: number, visits: string[]): void {
  const log: string[] = [];
  const callback = function (this: FindRule, value: number, index: number, owner: number[]): boolean {
    log[log.length] = index + ":" + value + ":" + this.kind + ":" + (owner === items);
    return this.kind === "above" ? value > this.minimum : value < this.maximum;
  };
  const result = items.find(callback, context);
  assert.sameValue(result, expected); assert.compareArray(log, visits);
}
run({ kind: "above", minimum: 10 }, 12, ["0:5:above:true", "1:12:above:true"]);
run({ kind: "below", maximum: 6 }, 5, ["0:5:below:true"]);
console.log("callbacks-find-this-narrowed-union:ok");
