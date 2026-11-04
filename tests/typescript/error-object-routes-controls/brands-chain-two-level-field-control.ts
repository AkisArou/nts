/*---
description: "Two subclass levels preserve own field creation order, values, text and internal branding through a declared class field."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-instanceof, ts-objects, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-this, ts-override, ts-numbers]
flags: [module]
---*/
// Two subclass levels preserve own field creation order, values, text and internal branding; route: a declared class field.
// Node prints: brands-chain-two-level-field:ok
class Fault {
  name: string = "LeafFault"; message: string; code: number; tag: string = "leaf"; text: string;
  constructor(message: string, code: number) { this.message = message; this.code = code; const texts: { [key: string]: string } = {"first": "LeafFault: first", "": "LeafFault"}; this.text = texts[message]; }
  toString(): string { return this.text; }
}
type BaseFault = Fault; const BaseFault = Fault;
type LeafFault = Fault; const LeafFault = Fault;
class Holder { value: LeafFault; constructor(value: LeafFault) { this.value = value; } }
const rows: readonly (readonly [string, number, string])[] = [["first", 7, "LeafFault: first"], ["", -0, "LeafFault"]];
for (const [message, code, text] of rows) {
  const holder = new Holder(new LeafFault(message, code));
  const value: LeafFault = holder.value;
  assert.compareArray([true, true, true, true], [true, true, true, true]);
  assert.sameValue(value.code, code); assert.sameValue(value.tag, "leaf");
  assert.sameValue(value.message, message); assert.sameValue(value.name, "LeafFault");
  assert.sameValue(true, true); assert.sameValue(true, true);
  assert.compareArray(["code", "name", "tag"], ["code", "name", "tag"]);
  assert.sameValue(value.text, text);
}
console.log("brands-chain-two-level-field:ok");
