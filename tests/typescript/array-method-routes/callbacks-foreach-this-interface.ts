/*---
description: "forEach binds a declared-this callback to either context implementation through an interface with two callback-context implementations."
features: [ts-array-method-routes, ts-array-method-route-callbacks, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-strings, ts-class, ts-interfaces, ts-this-parameter, ts-null-undefined]
---*/
// forEach binds a declared-this callback to either context implementation; route: an interface with two callback-context implementations.
// Node prints: callbacks-foreach-this-interface:ok
interface VisitScale { factor: number }
class DoubleScale implements VisitScale { factor: number = 2; }
class NegativeScale implements VisitScale { factor: number = -3; }
const items: number[] = [4, 1, 7];
function run(context: VisitScale, expected: string[]): void {
  const log: string[] = [];
  const callback = function (this: VisitScale, value: number, index: number, owner: number[]): void {
    log[log.length] = index + ":" + (value * this.factor) + ":" + (owner === items);
  };
  const result = items.forEach(callback, context);
  assert.sameValue(result, undefined); assert.compareArray(log, expected);
}
run(new DoubleScale(), ["0:8:true", "1:2:true", "2:14:true"]);
run(new NegativeScale(), ["0:-12:true", "1:-3:true", "2:-21:true"]);
console.log("callbacks-foreach-this-interface:ok");
