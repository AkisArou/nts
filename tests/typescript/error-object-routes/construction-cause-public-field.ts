/*---
description: "Absent and empty options omit cause; explicit undefined and falsy causes are own properties, and object causes retain identity."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-class, ts-class-fields, ts-this, ts-unknown, ts-objects, ts-numbers]
flags: [module]
---*/
// Absent and empty options omit cause; explicit undefined and falsy causes are own properties, and object causes retain identity. Route: a public Error field.
// Node prints: construction-cause-public-field:ok
const first = { id: 1 }, second = { id: 2 };
const inputs: Error[] = [new Error("m"), new Error("m", undefined), new Error("m", {}), new Error("m", { cause: undefined }), new Error("m", { cause: first }), new Error("m", { cause: second }), new Error("m", { cause: 0 }), new Error("m", { cause: false }), new Error("m", { cause: null })];
const expected: unknown[] = [undefined, undefined, undefined, undefined, first, second, 0, false, null];
const own: boolean[] = [false, false, false, true, true, true, true, true, true];
class Holder { value: Error; constructor(value: Error) { this.value = value; } }
const holder = new Holder(inputs[0]);
for (let index = 0; index < inputs.length; index++) {
  holder.value = inputs[index];
  const value: Error = holder.value;
  assert.sameValue(value.cause, expected[index]);
  assert.sameValue(Object.hasOwn(value, "cause"), own[index]);
}
console.log("construction-cause-public-field:ok");
