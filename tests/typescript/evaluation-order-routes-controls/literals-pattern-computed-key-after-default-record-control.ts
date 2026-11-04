/*---
description: "A later computed binding key observes the first default immediately. The control evaluates the parts in separate statements."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-record, ts-objects, ts-accessors, ts-computed-keys, ts-unions, ts-null-undefined]
---*/
// A Record route supplies computed bindings; node runs the first default before choosing the second key and preserves a present first value. The control names each ordered part.
const log: string[] = [];
let nextKey = "before";
function key(label: string): string { log.push("key:" + label); return label === "first" ? "first" : nextKey; }
function fallback(input: number): number { log.push("default"); nextKey = "after"; return input + 1; }
function read(source: Record<string, number | undefined>, input: number): (number | undefined)[] {
  log.push("read");
  const sourcePart = source;
  const firstKey = key("first");
  const firstPart = sourcePart[firstKey];
  let selected = firstPart;
  if (selected === undefined) { const replacement = fallback(input); selected = replacement; }
  const first = selected;
  const secondKey = key("second");
  const second = sourcePart[secondKey];
  return [first, second];
}
for (const missing of [false, true]) for (const input of [4, 11]) {
  log.length = 0; nextKey = "before";
  const source: Record<string, number | undefined> = { get first(): number | undefined { log.push("get:first"); return missing ? undefined : input; }, get before(): number { log.push("get:before"); return input + 10; }, get after(): number { log.push("get:after"); return input + 20; } };
  const result = read(source, input);
  assert.compareArray(log, missing ? ["read", "key:first", "get:first", "default", "key:second", "get:after"] : ["read", "key:first", "get:first", "key:second", "get:before"]);
  assert.compareArray(result, [missing ? input + 1 : input, missing ? input + 20 : input + 10]); assert.sameValue(nextKey, missing ? "after" : "before");
}
