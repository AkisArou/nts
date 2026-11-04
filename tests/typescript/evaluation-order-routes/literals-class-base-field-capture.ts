/*---
description: "A base field initializer captures an earlier field before its helper changes it."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-computed-keys, ts-interfaces, ts-objects, ts-this]
---*/
// A class field reaches the next initializer; node retains the left value across a helper mutation, initializes the later field, then enters the constructor body.
const log: string[] = [];
interface Route { seed: number; }
let route: Route = { seed: 0 };
const firstKey: "first" = "first";
function start(source: Route): number { log.push("first"); return source.seed; }
function change(owner: { first: number }): number { log.push("change"); owner.first += 10; return 2; }
function read(owner: { first: number }): number { log.push("third"); return owner.first; }
class Owner {
  [firstKey]: number = start(route);
  second: number = this.first + change(this);
  third: number = read(this);
  constructor() { log.push("body"); this.third++; }
}
for (const input of [2, 9]) {
  log.length = 0; route = { seed: input }; const result = new Owner();
  assert.compareArray(log, ["first", "change", "third", "body"]);
  assert.sameValue(result.first, input + 10); assert.sameValue(result.second, input + 2); assert.sameValue(result.third, input + 11);
  assert.compareArray(Object.keys(result), ["first", "second", "third"]); assert.sameValue(typeof result.second, "number");
}
