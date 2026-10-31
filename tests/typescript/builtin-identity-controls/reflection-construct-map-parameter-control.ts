/*---
description: Control for reflection-construct-map-parameter; remove the reflected route.
features: [ts-builtin-identity, ts-builtin-reflection, ts-functions, ts-iteration, ts-map-set, ts-construct-signatures, ts-tuples, ts-instanceof]
---*/
// Paired case: ../builtin-identity/reflection-construct-map-parameter.ts.
// Control: Reflect.construct(target, [entries]) becomes new target(entries).
function build(target: new (entries: [string, number][]) => Map<string, number>, entries: [string, number][]): Map<string, number> {
  const result: Map<string, number> = new target(entries);
  return result;
}
for (const n of [-3, 0, 7]) {
  const result = build(Map, [["item", n], ["other", n + 1]]);
  assert.sameValue(result instanceof Map, true);
  assert.sameValue(result.size, 2);
  assert.sameValue(result.get("item"), n);
  assert.sameValue(result.get("other"), n + 1);
}
