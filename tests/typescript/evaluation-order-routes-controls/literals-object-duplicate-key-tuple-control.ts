/*---
description: "Duplicate computed properties evaluate both values before the later value wins. The control evaluates the parts in separate statements."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-tuples, ts-readonly, ts-objects, ts-record, ts-computed-keys, ts-typeof-operator]
---*/
// Two keys cross a declared tuple; node evaluates first key/value then second key/value, retaining the later value under one property. The control names each ordered part.
const log: string[] = [];
let current = 0;
function key(route: readonly [string, string], index: number): string { log.push("key:" + index); return route[index]; }
function value(index: number): number { log.push("value:" + index); const before = current; current += index + 1; return before; }
function build(route: readonly [string, string]): Record<string, number> {
  log.push("build");
  const firstKey = key(route, 0);
  const firstValue = value(0);
  const secondKey = key(route, 1);
  const secondValue = value(1);
  return { [firstKey]: firstValue, [secondKey]: secondValue };
}
for (const input of [2, 9]) {
  log.length = 0; current = input; const route: readonly [string, string] = ["same", "same"];
  const result = build(route);
  assert.compareArray(log, ["build", "key:0", "value:0", "key:1", "value:1"]);
  assert.sameValue(result.same, input + 1); assert.sameValue(typeof result.same, "number"); assert.sameValue(current, input + 3); assert.compareArray(Object.keys(result), ["same"]);
}
