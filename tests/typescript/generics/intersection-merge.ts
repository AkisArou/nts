/*---
description: A generic merge of two objects returns their intersection, holding every property of both.
features: [ts-generics, ts-intersections, ts-spread]
---*/
function merge<A extends object, B extends object>(a: A, b: B): A & B {
  return { ...a, ...b };
}
const merged = merge({ id: 1, label: "first" }, { label: "second", active: true });
assert.sameValue(merged.id, 1);
assert.sameValue(merged.label, "second");
assert.sameValue(merged.active, true);
assert.sameValue(Object.keys(merged).join(","), "id,label,active");
