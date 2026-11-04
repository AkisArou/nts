/*---
description: "Absent and empty options omit cause; explicit undefined and falsy causes are own properties, and object causes retain identity."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-class, ts-class-fields, ts-static, ts-unknown, ts-objects, ts-numbers]
flags: [module]
---*/
// Absent and empty options omit cause; explicit undefined and falsy causes are own properties, and object causes retain identity. Route: a static Error field.
// Node prints: construction-cause-static-field:ok
const first = { id: 1 }, second = { id: 2 };
const inputs: Error[] = [new RangeError("m"), new RangeError("m", undefined), new RangeError("m", {}), new RangeError("m", { cause: undefined }), new RangeError("m", { cause: first }), new RangeError("m", { cause: second }), new RangeError("m", { cause: 0 }), new RangeError("m", { cause: false }), new RangeError("m", { cause: null })];
const expected: unknown[] = [undefined, undefined, undefined, undefined, first, second, 0, false, null];
const own: boolean[] = [false, false, false, true, true, true, true, true, true];
class Holder { static value: Error; }
for (let index = 0; index < inputs.length; index++) {
  Holder.value = inputs[index];
  const value: Error = Holder.value;
  assert.sameValue(value.cause, expected[index]);
  assert.sameValue(Object.hasOwn(value, "cause"), own[index]);
}
console.log("construction-cause-static-field:ok");
