/*---
description: A typed constructor read from globalThis.Map constructs the real builtin.
features: [ts-builtin-identity, ts-builtin-reflection, ts-functions, ts-iteration, ts-map-set, ts-instanceof]
---*/
// Route: globalThis.Map stored in a typed variable; node follows the actual value.
function build(n: number): Map<string, number> {
  const target: MapConstructor = globalThis.Map;
  return new target<string, number>([["item", n]]);
}
for (const n of [-3, 0, 7]) {
  const result = build(n);
  assert.sameValue(result instanceof Map, true);
  assert.sameValue(result.size, 1);
  assert.sameValue(result.get("item"), n);
}
