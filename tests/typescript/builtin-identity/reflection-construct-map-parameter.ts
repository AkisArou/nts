/*---
description: Reflect.construct reaches the real Map through a typed constructor parameter.
features: [ts-builtin-identity, ts-builtin-reflection, ts-functions, ts-iteration, ts-map-set, ts-construct-signatures, ts-tuples, ts-instanceof]
---*/
// Route: Reflect.construct of a typed Map constructor; node follows the actual value.
function build(target: new (entries: [string, number][]) => Map<string, number>, entries: [string, number][]): Map<string, number> {
  const result: Map<string, number> = Reflect.construct(target, [entries]);
  return result;
}
for (const n of [-3, 0, 7]) {
  const result = build(Map, [["item", n], ["other", n + 1]]);
  assert.sameValue(result instanceof Map, true);
  assert.sameValue(result.size, 2);
  assert.sameValue(result.get("item"), n);
  assert.sameValue(result.get("other"), n + 1);
}
