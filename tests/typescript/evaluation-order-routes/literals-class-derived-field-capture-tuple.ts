/*---
description: "Derived fields initialize after super and capture earlier fields before mutation."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-tuples, ts-readonly, ts-objects, ts-this, ts-instanceof]
---*/
// A readonly tuple supplies construction values; node runs base initialization, derived field parts and the remaining constructor body in that order.
const log: string[] = [];
function start(route: readonly [number, number]): number { log.push("base:field"); return route[0]; }
function argument(route: readonly [number, number]): number { log.push("argument"); return route[1]; }
function capture(value: number): number { log.push("derived:second"); return value; }
function change(owner: { first: number; second: number }): number { log.push("derived:change"); owner.first += 100; owner.second += 10; return 3; }
for (const input of [2, 9]) for (const offset of [1, 4]) {
  log.length = 0; const route: readonly [number, number] = [input, offset];
  class Base { first: number = start(route); constructor(value: number) { log.push("base:body"); this.first += value; } }
  class Child extends Base {
    second: number = capture(this.first);
    third: number = this.second + change(this);
    constructor() { log.push("derived:before"); super(argument(route)); log.push("derived:after"); this.third += 1000; }
  }
  const result = new Child();
  assert.compareArray(log, ["derived:before", "argument", "base:field", "base:body", "derived:second", "derived:change", "derived:after"]);
  assert.sameValue(result.first, input + offset + 100); assert.sameValue(result.second, input + offset + 10); assert.sameValue(result.third, input + offset + 1003);
  assert.sameValue(result instanceof Base, true); assert.compareArray(Object.keys(result), ["first", "second", "third"]); assert.sameValue(typeof result.third, "number");
}
