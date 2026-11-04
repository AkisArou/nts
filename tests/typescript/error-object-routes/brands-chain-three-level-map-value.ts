/*---
description: "Three subclass levels retain ancestor identity and exact own field order through later alias writes through a guarded Map.get."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-instanceof, ts-objects, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-this, ts-numbers, ts-map-set]
flags: [module]
---*/
// Three subclass levels retain ancestor identity and exact own field order through later alias writes; route: a guarded Map.get.
// Node prints: brands-chain-three-level-map-value:ok
class RootFault extends Error { root: string = "root"; }
class MiddleFault extends RootFault { middle: number = 2; }
class LeafFault extends MiddleFault { leaf: boolean = true; }
const store: Map<string, LeafFault> = new Map();
function read(): LeafFault { const item = store.get("fault"); if (item === undefined) throw "missing"; return item; }
const rows: readonly (readonly [string, string])[] = [["one", "Error: one"], ["two", "Error: two"]];
for (const [message, text] of rows) {
  const original: LeafFault = new LeafFault(message); store.set("fault", original);
  const value: LeafFault = read();
  assert.sameValue(value, original);
  assert.compareArray([value instanceof LeafFault, value instanceof MiddleFault, value instanceof RootFault, value instanceof Error, Error.isError(value)], [true, true, true, true, true]);
  assert.sameValue(value.root, "root"); assert.sameValue(value.middle, 2); assert.sameValue(value.leaf, true);
  assert.compareArray(Object.keys(value), ["root", "middle", "leaf"]);
  assert.sameValue(Object.hasOwn(value, "message"), true); assert.sameValue(String(value), text);
  value.middle = 9; assert.sameValue(original.middle, 9);
}
console.log("brands-chain-three-level-map-value:ok");
