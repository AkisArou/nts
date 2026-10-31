/*---
description: Control for reflection-prototype-map-parameter; remove the reflected route.
features: [ts-builtin-identity, ts-builtin-reflection, ts-functions, ts-iteration, ts-class, ts-map-set, ts-builtin-subclass, ts-inheritance, ts-instanceof]
---*/
// Paired case: ../builtin-identity/reflection-prototype-map-parameter.ts.
// Control: Object.getPrototypeOf(value) === Map.prototype becomes value instanceof Map.
class ChildMap extends Map<string, number> {}
function isDirect(value: Map<string, number>): boolean {
  return value instanceof Map;
}
for (const n of [-3, 0, 7]) {
  const plain: Map<string, number> = new Map([["item", n]]);
  const child: Map<string, number> = new ChildMap([["item", n]]);
  assert.sameValue(isDirect(plain), true);
  assert.sameValue(isDirect(child), true);
  assert.sameValue(plain.get("item"), n);
  assert.sameValue(child.get("item"), n);
}
