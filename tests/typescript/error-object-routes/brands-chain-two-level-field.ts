/*---
description: "Two subclass levels preserve own field creation order, values, text and internal branding through a declared class field."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-instanceof, ts-objects, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-this, ts-override, ts-numbers]
flags: [module]
---*/
// Two subclass levels preserve own field creation order, values, text and internal branding; route: a declared class field.
// Node prints: brands-chain-two-level-field:ok
class BaseFault extends Error {
  code: number;
  constructor(message: string, code: number) { super(message); this.code = code; }
}
class LeafFault extends BaseFault { override name: string = "LeafFault"; tag: string = "leaf"; }
class Holder { value: LeafFault; constructor(value: LeafFault) { this.value = value; } }
const rows: readonly (readonly [string, number, string])[] = [["first", 7, "LeafFault: first"], ["", -0, "LeafFault"]];
for (const [message, code, text] of rows) {
  const holder = new Holder(new LeafFault(message, code));
  const value: LeafFault = holder.value;
  assert.compareArray([value instanceof LeafFault, value instanceof BaseFault, value instanceof Error, Error.isError(value)], [true, true, true, true]);
  assert.sameValue(value.code, code); assert.sameValue(value.tag, "leaf");
  assert.sameValue(value.message, message); assert.sameValue(value.name, "LeafFault");
  assert.sameValue(Object.hasOwn(value, "message"), true); assert.sameValue(Object.hasOwn(value, "name"), true);
  assert.compareArray(Object.keys(value), ["code", "name", "tag"]);
  assert.sameValue(String(value), text);
}
console.log("brands-chain-two-level-field:ok");
