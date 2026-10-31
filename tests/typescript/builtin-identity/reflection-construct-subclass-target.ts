/*---
description: Reflect.construct preserves a typed Map subclass target and forwards its arguments.
features: [ts-builtin-identity, ts-builtin-reflection, ts-functions, ts-iteration, ts-class, ts-map-set, ts-builtin-subclass, ts-inheritance, ts-instanceof, ts-tuples, ts-typeof-type]
---*/
// Route: Reflect.construct of a typed subclass target; node follows the actual value.
let calls = 0;
class ChildMap extends Map<string, number> {
  constructor(entries: [string, number][]) { super(entries); calls++; }
}
function build(target: typeof ChildMap, entries: [string, number][]): ChildMap {
  const result: ChildMap = Reflect.construct(target, [entries]);
  return result;
}
for (const n of [-3, 0, 7]) {
  calls = 0;
  const result = build(ChildMap, [["item", n]]);
  assert.sameValue(calls, 1);
  assert.sameValue(result instanceof ChildMap, true);
  assert.sameValue(result instanceof Map, true);
  assert.sameValue(result.size, 1);
  assert.sameValue(result.get("item"), n);
}
