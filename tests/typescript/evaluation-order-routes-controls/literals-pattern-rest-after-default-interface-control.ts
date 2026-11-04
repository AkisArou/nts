/*---
description: "Object rest enumerates the source after an earlier default changes its keys. The control evaluates the parts in separate statements."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-record, ts-objects, ts-accessors, ts-tuples, ts-unions, ts-null-undefined]
---*/
// An interface-held Record reaches a default and rest pattern; node copies the keys that exist after the default adds one and removes another. The control names each ordered part.
const log: string[] = [];
interface Holder { source: Record<string, number | undefined>; }
let current = 0;
function fallback(source: Record<string, number | undefined>, input: number): number { log.push("default"); current += 100; delete source.drop; source.added = input + 30; return input + 1; }
function read(holder: Holder, input: number): [number, Record<string, number | undefined>] {
  log.push("read");
  const sourcePart = holder.source;
  const firstPart = sourcePart.first;
  let selected = firstPart;
  if (selected === undefined) { const replacement = fallback(holder.source, input); selected = replacement; }
  const first = selected;
  const keys = Object.keys(sourcePart);
  const rest: Record<string, number | undefined> = {};
  for (const key of keys) if (key !== "first") { const part = sourcePart[key]; rest[key] = part; }
  return [first, rest];
}
for (const missing of [false, true]) for (const input of [2, 7]) {
  log.length = 0; current = input;
  const source: Record<string, number | undefined> = { get first(): number | undefined { log.push("get:first"); return missing ? undefined : input; }, drop: input + 20, get keep(): number { log.push("get:keep"); return current; } };
  const result = read({ source }, input), rest = result[1];
  assert.compareArray(log, missing ? ["read", "get:first", "default", "get:keep"] : ["read", "get:first", "get:keep"]);
  assert.sameValue(result[0], missing ? input + 1 : input); assert.compareArray(Object.keys(rest), missing ? ["keep", "added"] : ["drop", "keep"]);
  assert.sameValue(rest.keep, missing ? input + 100 : input); assert.sameValue(rest.drop, missing ? undefined : input + 20); assert.sameValue(rest.added, missing ? input + 30 : undefined); assert.sameValue("first" in rest, false);
}
