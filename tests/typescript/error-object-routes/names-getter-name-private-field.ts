/*---
description: "A name getter prints correctly without becoming an own property through a private Error field."
features: [ts-error-object-routes, ts-error-object-route-names, ts-errors, ts-functions, ts-strings, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-override, ts-accessors, ts-private-fields, ts-this, ts-arrays, ts-tuples, ts-readonly, ts-iteration, ts-template-literals]
flags: [module]
---*/
// A name getter prints correctly without becoming an own property; route: a private Error field.
// Node prints: names-getter-name-private-field:ok
class GetterNamed extends Error { override get name(): string { return "GetterNamed"; } }
class Holder { #error: Error; constructor(error: Error) { this.#error = error; } read(): Error { return this.#error; } }
const rows: readonly (readonly [string, string])[] = [["m", "GetterNamed: m"], ["", "GetterNamed"]];
for (const [message, expected] of rows) {
  const error: Error = new Holder(new GetterNamed(message)).read();
  const text: string = `${error}`; const own: boolean = Object.hasOwn(error, "name"); const keys: string[] = Object.keys(error);
  assert.sameValue(text, expected); assert.sameValue(own, false); assert.compareArray(keys, []);
}
console.log("names-getter-name-private-field:ok");
