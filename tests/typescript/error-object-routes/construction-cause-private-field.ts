/*---
description: "Absent and empty options omit cause; explicit undefined and falsy causes are own properties, and object causes retain identity."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-unknown, ts-objects, ts-numbers]
flags: [module]
---*/
// Absent and empty options omit cause; explicit undefined and falsy causes are own properties, and object causes retain identity. Route: a private Error field.
// Node prints: construction-cause-private-field:ok
const first = { id: 1 }, second = { id: 2 };
const inputs: Error[] = [new TypeError("m"), new TypeError("m", undefined), new TypeError("m", {}), new TypeError("m", { cause: undefined }), new TypeError("m", { cause: first }), new TypeError("m", { cause: second }), new TypeError("m", { cause: 0 }), new TypeError("m", { cause: false }), new TypeError("m", { cause: null })];
const expected: unknown[] = [undefined, undefined, undefined, undefined, first, second, 0, false, null];
const own: boolean[] = [false, false, false, true, true, true, true, true, true];
class Holder {
  #value: Error; constructor(value: Error) { this.#value = value; }
  set(value: Error): void { this.#value = value; }
  get(): Error { return this.#value; }
}
const holder = new Holder(inputs[0]);
for (let index = 0; index < inputs.length; index++) {
  holder.set(inputs[index]);
  const value: Error = holder.get();
  assert.sameValue(value.cause, expected[index]);
  assert.sameValue(Object.hasOwn(value, "cause"), own[index]);
}
console.log("construction-cause-private-field:ok");
