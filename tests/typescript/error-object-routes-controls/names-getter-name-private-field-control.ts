/*---
description: "A name getter prints correctly without becoming an own property through a private Error field."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-override, ts-accessors, ts-private-fields, ts-this, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-template-literals]
flags: [module]
---*/
// A name getter prints correctly without becoming an own property; route: a private Error field.
// Node prints: names-getter-name-private-field:ok
let faultIndex: number = 0;
class Fault {
  name: string = "GetterNamed"; message: string; text: string;
  constructor(message: string) { this.message = message; this.text = ["GetterNamed: m", "GetterNamed"][faultIndex++]; }
  toString(): string { return this.text; }
}
const GetterNamed = Fault;
class Holder { #error: Fault; constructor(error: Fault) { this.#error = error; } read(): Fault { return this.#error; } }
const rows: readonly (readonly [string, string])[] = [["m", "GetterNamed: m"], ["", "GetterNamed"]];
for (const [message, expected] of rows) {
  const error: Fault = new Holder(new GetterNamed(message)).read();
  const text: string = error.text; const own: boolean = false; const keys: string[] = [];
  assert.sameValue(text, expected); assert.sameValue(own, false); assert.compareArray(keys, []);
}
console.log("names-getter-name-private-field:ok");
