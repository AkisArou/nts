/*---
description: "Successive object spreads recopy a getter after an intervening mutation."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-generics, ts-generic-constraints, ts-interfaces, ts-objects, ts-accessors, ts-spread]
---*/
// A generic source reaches two spreads in one literal; node snapshots the first getter, runs the middle mutation, then overwrites from a fresh second read.
const log: string[] = [];
interface View { value: number; }
let current = 0;
function advance(): number { log.push("advance"); current += 10; return current + 1; }
function build<T extends View>(source: T): { value: number; pivot: number } {
  log.push("build");
  return { ...source, pivot: advance(), ...source };
}
for (const input of [1, 6]) {
  log.length = 0; current = input;
  const source: View = { get value(): number { log.push("get:" + current); return current; } };
  const result = build(source);
  assert.compareArray(log, ["build", "get:" + input, "advance", "get:" + (input + 10)]);
  assert.sameValue(result.value, input + 10); assert.sameValue(result.pivot, input + 11); assert.sameValue(current, input + 10); assert.compareArray(Object.keys(result), ["value", "pivot"]);
}
