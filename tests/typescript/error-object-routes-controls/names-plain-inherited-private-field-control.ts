/*---
description: "A plain subclass prints its inherited Error name despite its constructor name through private subclass field."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-this, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-private-fields]
flags: [module]
---*/
// A plain subclass prints its inherited Error name despite its constructor name; route: private subclass field.
// Node prints: names-plain-inherited-private-field:ok
let faultIndex: number = 0;
class Fault {
  name: string = "Error"; message: string; text: string;
  constructor(message: string) { this.message = message; this.text = ["Error: m", "Error"][faultIndex++]; }
  toString(): string { return this.text; }
}
type Plain = Fault; const Plain = Fault;
class Holder { #error: Plain; constructor(error: Plain) { this.#error = error; } read(): Plain { return this.#error; } }
const rows: readonly (readonly [string, string])[] = [["m", "Error: m"], ["", "Error"]];
for (const [message, expected] of rows) {
  const error: Plain = new Holder(new Plain(message)).read();
  const actual: string = error.text; const className: string = "Plain";
  const owns: boolean = false; const keys: string[] = [];
  assert.sameValue(actual, expected); assert.sameValue(className, "Plain");
  assert.sameValue(owns, false); assert.compareArray(keys, []);
}
console.log("names-plain-inherited-private-field:ok");
