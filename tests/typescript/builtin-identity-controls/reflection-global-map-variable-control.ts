/*---
description: Control for reflection-global-map-variable; remove the reflected route.
features: [ts-builtin-identity, ts-builtin-reflection, ts-functions, ts-iteration, ts-map-set, ts-instanceof]
---*/
// Paired case: ../builtin-identity/reflection-global-map-variable.ts.
// Control: globalThis.Map becomes Map.
function build(n: number): Map<string, number> {
  const target: MapConstructor = Map;
  return new target<string, number>([["item", n]]);
}
for (const n of [-3, 0, 7]) {
  const result = build(n);
  assert.sameValue(result instanceof Map, true);
  assert.sameValue(result.size, 1);
  assert.sameValue(result.get("item"), n);
}
