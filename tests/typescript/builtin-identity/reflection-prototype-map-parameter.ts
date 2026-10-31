/*---
description: Prototype equality through a base-typed Map parameter distinguishes the builtin from its subclass.
features: [ts-builtin-identity, ts-builtin-reflection, ts-functions, ts-iteration, ts-class, ts-map-set, ts-builtin-subclass, ts-inheritance, ts-instanceof]
---*/
// Route: Object.getPrototypeOf on a base-typed parameter; node follows the actual value.
class ChildMap extends Map<string, number> {}
function isDirect(value: Map<string, number>): boolean {
  return Object.getPrototypeOf(value) === Map.prototype;
}
for (const n of [-3, 0, 7]) {
  const plain: Map<string, number> = new Map([["item", n]]);
  const child: Map<string, number> = new ChildMap([["item", n]]);
  assert.sameValue(isDirect(plain), true);
  assert.sameValue(isDirect(child), false);
  assert.sameValue(plain.get("item"), n);
  assert.sameValue(child.get("item"), n);
}
