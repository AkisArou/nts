/*---
description: "Computed accessor and data definitions retain source order without invoking the replaced getter. The control evaluates the parts in separate statements."
features: [ts-evaluation-order-routes, ts-evaluation-order-route-literals, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-interfaces, ts-objects, ts-record, ts-accessors, ts-computed-keys]
---*/
// Computed names cross an interface method; node creates an accessor, then replaces it with data after evaluating both keys and the later value. The control names each ordered part.
const log: string[] = [];
interface Names { choose(label: string): string; }
let current = 0;
function value(): number { log.push("value"); current += 5; return current; }
function build(names: Names): Record<string, number> {
  log.push("build");
  const accessorKey = names.choose("accessor");
  const dataKey = names.choose("data");
  const dataValue = value();
  return { get [accessorKey](): number { log.push("getter"); return current; }, [dataKey]: dataValue };
}
for (const input of [2, 10]) {
  log.length = 0; current = input;
  const names: Names = { choose(label: string): string { log.push("key:" + label); return "same"; } };
  const result = build(names), observed = result.same;
  assert.compareArray(log, ["build", "key:accessor", "key:data", "value"]);
  assert.sameValue(observed, input + 5); assert.sameValue(current, input + 5); assert.compareArray(Object.keys(result), ["same"]);
}
