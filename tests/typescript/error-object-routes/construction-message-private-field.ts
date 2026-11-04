/*---
description: "Omitted and undefined messages have no own property; empty and nonempty messages have an own property."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-numbers]
flags: [module]
---*/
// Omitted and undefined messages have no own property; empty and nonempty messages have an own property. Route: a private Error field.
// Node prints: construction-message-private-field:ok
const inputs: Error[] = [new TypeError(), new TypeError(undefined), new TypeError(""), new TypeError("alpha")];
const expected: string[] = ["", "", "", "alpha"];
const own: boolean[] = [false, false, true, true];
class Holder {
  #value: Error; constructor(value: Error) { this.#value = value; }
  set(value: Error): void { this.#value = value; }
  get(): Error { return this.#value; }
}
const holder = new Holder(inputs[0]);
for (let index = 0; index < inputs.length; index++) {
  holder.set(inputs[index]);
  const value: Error = holder.get();
  assert.sameValue(value.name, "TypeError");
  assert.sameValue(value.message, expected[index]);
  assert.sameValue(Object.hasOwn(value, "message"), own[index]);
}
console.log("construction-message-private-field:ok");
