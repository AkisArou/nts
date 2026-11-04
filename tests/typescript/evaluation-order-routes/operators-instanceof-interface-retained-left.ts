/*---
description: Instanceof keeps its left value through right-operand mutation before a static hook.
features: [ts-evaluation-order-routes, ts-evaluation-order-route-operators, ts-class, ts-class-fields, ts-static, ts-symbols, ts-unknown, ts-interfaces, ts-accessors, ts-functions, ts-objects, ts-arrays, ts-iteration, ts-instanceof]
---*/
// instanceof through interface accessors; node retains the left object while the right replaces its carrier, then calls static hasInstance.
const log: string[] = [];
class Gate {
  static expected: object = {};
  static seen: unknown = undefined;
  static receiver: unknown = undefined;
  static [Symbol.hasInstance](value: unknown): boolean {
    log.push("hasInstance"); Gate.seen = value; Gate.receiver = this;
    return value === Gate.expected;
  }
}
interface Source { readonly value: object; readonly constructorValue: typeof Gate; }
function inspect(source: Source): boolean {
  log.push("inspect");
  return source.value instanceof source.constructorValue;
}
for (const match of [true, false]) {
  const first: object = { id: 1 }, second: object = { id: 2 };
  let current = first;
  const source: Source = {
    get value(): object { log.push("left"); return current; },
    get constructorValue(): typeof Gate { log.push("right"); current = second; Gate.expected = match ? first : second; return Gate; }
  };
  log.length = 0;
  const result = inspect(source);
  assert.compareArray(log, ["inspect", "left", "right", "hasInstance"]);
  assert.sameValue(result, match);
  assert.sameValue(current, second);
  assert.sameValue(Gate.seen, first);
  assert.sameValue(Gate.receiver, Gate);
}
