/*---
description: "An object pattern retains its source when a default replaces its carrier."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-objects, ts-accessors, ts-destructuring, ts-unions, ts-null-undefined]
---*/
// A source crosses an interface field into a binding pattern; node reads the original second property after the first default replaces the field.
const log: string[] = [];
interface Source { first: number | undefined; second: number; }
interface Holder { source: Source; }
function replace(holder: Holder, input: number): number { log.push("default"); holder.source = { first: 900, second: 901 }; return input + 10; }
function read(holder: Holder, input: number): number[] {
  log.push("read");
  const { first = replace(holder, input), second } = holder.source;
  return [first, second];
}
for (const missing of [false, true]) for (const input of [2, 8]) {
  log.length = 0;
  const source: Source = { get first(): number | undefined { log.push("get:first"); return missing ? undefined : input; }, get second(): number { log.push("get:second"); return input + 1; } };
  const holder: Holder = { source }; const result = read(holder, input);
  assert.compareArray(log, missing ? ["read", "get:first", "default", "get:second"] : ["read", "get:first", "get:second"]);
  assert.compareArray(result, [missing ? input + 10 : input, input + 1]); assert.sameValue(holder.source === source, !missing); assert.sameValue(typeof result[0], "number");
}
