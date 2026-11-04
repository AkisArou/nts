/*---
description: "An object spread copies getter values at its exact position between surrounding fields."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-objects, ts-accessors, ts-spread, ts-typeof-operator]
---*/
// A getter-bearing object crosses an interface field; node evaluates the leading value, copies getters, then evaluates the trailing value with the changed state.
const log: string[] = [];
interface Source { first: number; second: number; }
interface Holder { source: Source; }
let current = 0;
function edge(label: string): number { log.push(label); const result = current; current += 1; return result; }
function build(holder: Holder): { before: number; first: number; second: number; after: number } {
  log.push("build");
  return { before: edge("before"), ...holder.source, after: edge("after") };
}
for (const input of [0, 8]) {
  log.length = 0; current = input;
  const holder: Holder = { source: { get first(): number { log.push("get:first"); const result = current; current += 10; return result; }, get second(): number { log.push("get:second"); return current; } } };
  const result = build(holder);
  assert.compareArray(log, ["build", "before", "get:first", "get:second", "after"]);
  assert.compareArray([result.before, result.first, result.second, result.after, current], [input, input + 1, input + 11, input + 11, input + 12]); assert.compareArray(Object.keys(result), ["before", "first", "second", "after"]); assert.sameValue(typeof result.first, "number");
}
