/*---
description: "Three subclass levels retain ancestor identity and exact own field order through later alias writes through a private field."
features: [ts-error-object-routes, ts-error-object-route-brands, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-instanceof, ts-objects, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-this, ts-numbers, ts-private-fields]
flags: [module]
---*/
// Three subclass levels retain ancestor identity and exact own field order through later alias writes; route: a private field.
// Node prints: brands-chain-three-level-private-field:ok
class Fault {
  name: string = "Error"; message: string; root: string = "root"; middle: number = 2; leaf: boolean = true; text: string;
  constructor(message: string) { this.message = message; const texts: { [key: string]: string } = {"one": "Error: one", "two": "Error: two"}; this.text = texts[message]; }
  toString(): string { return this.text; }
}
type RootFault = Fault; const RootFault = Fault;
type MiddleFault = Fault; const MiddleFault = Fault;
type LeafFault = Fault; const LeafFault = Fault;
class Holder { #value: LeafFault; constructor(value: LeafFault) { this.#value = value; } read(): LeafFault { return this.#value; } }
const rows: readonly (readonly [string, string])[] = [["one", "Error: one"], ["two", "Error: two"]];
for (const [message, text] of rows) {
  const original: LeafFault = new LeafFault(message);
  const value: LeafFault = new Holder(original).read();
  assert.sameValue(value, original);
  assert.compareArray([true, true, true, true, true], [true, true, true, true, true]);
  assert.sameValue(value.root, "root"); assert.sameValue(value.middle, 2); assert.sameValue(value.leaf, true);
  assert.compareArray(["root", "middle", "leaf"], ["root", "middle", "leaf"]);
  assert.sameValue(true, true); assert.sameValue(value.text, text);
  value.middle = 9; assert.sameValue(original.middle, 9);
}
console.log("brands-chain-three-level-private-field:ok");
