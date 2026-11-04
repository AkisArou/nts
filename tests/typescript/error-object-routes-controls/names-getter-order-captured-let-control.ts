/*---
description: "A prototype name getter adds no own key after the base constructor field through a captured mutable subclass binding."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-override, ts-accessors, ts-this, ts-arrays, ts-tuples, ts-iteration, ts-unions, ts-closures, ts-function-types, ts-arrow-functions, ts-narrowing]
flags: [module]
---*/
// A prototype name getter adds no own key after the base constructor field; route: a captured mutable subclass binding.
// Node prints: names-getter-order-captured-let:ok
class Fault {
  code: string; name: string = "Ordered"; message: string = "m"; text: string = "Ordered: m";
  constructor(code: string) { this.code = code; }
  toString(): string { return this.text; }
}
type Ordered = Fault; const Ordered = Fault;
let current: Ordered | undefined;
const read: () => [string[], string, boolean] = () => {
  if (current === undefined) throw "missing";
  return [["code"], current.text, false];
};
for (const code of ["E1", "E2"]) {
  current = new Ordered(code); const [keys, text, own] = read();
  assert.compareArray(keys, ["code"]); assert.sameValue(current.code, code); assert.sameValue(text, "Ordered: m"); assert.sameValue(own, false);
}
console.log("names-getter-order-captured-let:ok");
