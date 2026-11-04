/*---
description: "Static fields and blocks observe all earlier mutations in source order. The control evaluates the parts in separate statements."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-static, ts-interfaces, ts-objects]
---*/
// An interface carries shared initializer state; node interleaves static field values and blocks, retaining each captured field result. The control names each ordered part.
const log: string[] = [];
interface Route { value: number; }
function take(route: Route, label: string): number { log.push(label); const value = route.value; route.value++; return value; }
for (const input of [1, 6]) {
  log.length = 0; const route: Route = { value: input };
  class Built { static first: number; static second: number; static third: number; }
  const firstPart = take(route, "first");
  Built.first = firstPart;
  log.push("block:first"); route.value += Built.first; Built.first += 10;
  const secondLeft = take(route, "second");
  const secondRight = Built.first;
  Built.second = secondLeft + secondRight;
  log.push("block:second"); route.value += Built.second; Built.first += 100;
  const thirdLeft = take(route, "third");
  const thirdRight = Built.second;
  Built.third = thirdLeft + thirdRight;
  assert.compareArray(log, ["first", "block:first", "second", "block:second", "third"]);
  assert.sameValue(Built.first, input + 110); assert.sameValue(Built.second, input * 3 + 11); assert.sameValue(Built.third, input * 8 + 24); assert.sameValue(route.value, input * 5 + 14);
  assert.compareArray(Object.keys(Built), ["first", "second", "third"]); assert.sameValue(typeof Built.third, "number");
}
