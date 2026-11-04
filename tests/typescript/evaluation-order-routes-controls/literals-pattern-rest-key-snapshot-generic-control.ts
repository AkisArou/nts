/*---
description: "Object rest captures its key list before its getters add another property. The control evaluates the parts in separate statements."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-generics, ts-generic-constraints, ts-record, ts-objects, ts-accessors, ts-tuples]
---*/
// A generic Record reaches rest copying; node captures keys once, then a getter adds a source key that the current copy excludes. The control names each ordered part.
const log: string[] = [];
let current = 0;
function read<T extends Record<string, number>>(source: T): [number, Record<string, number>] {
  log.push("read");
  const sourcePart = source;
  const selected = sourcePart.selected;
  const keys = Object.keys(sourcePart);
  const rest: Record<string, number> = {};
  for (const key of keys) if (key !== "selected") { const part = sourcePart[key]; rest[key] = part; }
  return [selected, rest];
}
for (const input of [1, 8]) {
  log.length = 0; current = input;
  const source: Record<string, number> = { get selected(): number { log.push("get:selected"); return input; }, get first(): number { log.push("get:first"); current += 10; source.added = input + 100; return current; }, get second(): number { log.push("get:second"); return current + 1; } };
  const result = read(source), rest = result[1];
  assert.compareArray(log, ["read", "get:selected", "get:first", "get:second"]);
  assert.sameValue(result[0], input); assert.compareArray(Object.keys(rest), ["first", "second"]); assert.sameValue(rest.first, input + 10); assert.sameValue(rest.second, input + 11);
  assert.sameValue("added" in rest, false); assert.sameValue(source.added, input + 100); assert.sameValue(current, input + 10);
}
