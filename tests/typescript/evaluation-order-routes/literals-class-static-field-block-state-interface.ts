/*---
description: "Static fields and blocks observe all earlier mutations in source order."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-static, ts-class-static-block, ts-interfaces, ts-objects, ts-this]
---*/
// An interface carries shared initializer state; node interleaves static field values and blocks, retaining each captured field result.
const log: string[] = [];
interface Route { value: number; }
function take(route: Route, label: string): number { log.push(label); const value = route.value; route.value++; return value; }
for (const input of [1, 6]) {
  log.length = 0; const route: Route = { value: input };
  class Built {
    static first: number = take(route, "first");
    static { log.push("block:first"); route.value += this.first; this.first += 10; }
    static second: number = take(route, "second") + Built.first;
    static { log.push("block:second"); route.value += this.second; this.first += 100; }
    static third: number = take(route, "third") + Built.second;
  }
  assert.compareArray(log, ["first", "block:first", "second", "block:second", "third"]);
  assert.sameValue(Built.first, input + 110); assert.sameValue(Built.second, input * 3 + 11); assert.sameValue(Built.third, input * 8 + 24); assert.sameValue(route.value, input * 5 + 14);
  assert.compareArray(Object.keys(Built), ["first", "second", "third"]); assert.sameValue(typeof Built.third, "number");
}
