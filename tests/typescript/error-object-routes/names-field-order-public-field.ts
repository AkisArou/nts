/*---
description: "The base constructor field precedes the subclass name initializer through a public subclass field."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-override, ts-this, ts-arrays, ts-iteration]
flags: [module]
---*/
// The base constructor field precedes the subclass name initializer; route: a public subclass field.
// Node prints: names-field-order-public-field:ok
class Base extends Error { code: string; constructor(code: string) { super("m"); this.code = code; } }
class Ordered extends Base { override name: string = "Ordered"; }
class Holder { error: Ordered; constructor(error: Ordered) { this.error = error; } }
for (const code of ["E1", "E2"]) {
  const holder: Holder = new Holder(new Ordered(code)); const error: Ordered = holder.error;
  const keys: string[] = Object.keys(error); const text: string = String(error);
  assert.compareArray(keys, ["code", "name"]); assert.sameValue(error.code, code); assert.sameValue(text, "Ordered: m");
}
console.log("names-field-order-public-field:ok");
