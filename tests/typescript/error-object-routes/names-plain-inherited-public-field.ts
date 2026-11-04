/*---
description: "A plain subclass prints its inherited Error name despite its constructor name through public subclass field."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-this, ts-arrays, ts-tuples, ts-readonly, ts-iteration]
flags: [module]
---*/
// A plain subclass prints its inherited Error name despite its constructor name; route: public subclass field.
// Node prints: names-plain-inherited-public-field:ok
class Plain extends Error {}
class Holder { error: Plain; constructor(error: Plain) { this.error = error; } read(): Plain { return this.error; } }
const rows: readonly (readonly [string, string])[] = [["m", "Error: m"], ["", "Error"]];
for (const [message, expected] of rows) {
  const error: Plain = new Holder(new Plain(message)).read();
  const actual: string = error.toString(); const className: string = error.constructor.name;
  const owns: boolean = Object.hasOwn(error, "name"); const keys: string[] = Object.keys(error);
  assert.sameValue(actual, expected); assert.sameValue(className, "Plain");
  assert.sameValue(owns, false); assert.compareArray(keys, []);
}
console.log("names-plain-inherited-public-field:ok");
