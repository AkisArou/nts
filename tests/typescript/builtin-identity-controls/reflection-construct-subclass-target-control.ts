/*---
description: Control for reflection-construct-subclass-target; remove the reflected route.
features: [ts-builtin-identity, ts-builtin-reflection, ts-functions, ts-iteration, ts-class, ts-map-set, ts-builtin-subclass, ts-inheritance, ts-instanceof, ts-tuples, ts-typeof-type]
---*/
// Paired case: ../builtin-identity/reflection-construct-subclass-target.ts.
// Control: Reflect.construct(target, [entries]) becomes new target(entries).
let calls = 0;
class ChildMap extends Map<string, number> {
  constructor(entries: [string, number][]) { super(entries); calls++; }
}
function build(target: typeof ChildMap, entries: [string, number][]): ChildMap {
  const result: ChildMap = new target(entries);
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
