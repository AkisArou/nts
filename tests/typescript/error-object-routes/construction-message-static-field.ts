/*---
description: "Omitted and undefined messages have no own property; empty and nonempty messages have an own property."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-class, ts-class-fields, ts-static, ts-numbers]
flags: [module]
---*/
// Omitted and undefined messages have no own property; empty and nonempty messages have an own property. Route: a static Error field.
// Node prints: construction-message-static-field:ok
const inputs: Error[] = [new RangeError(), new RangeError(undefined), new RangeError(""), new RangeError("alpha")];
const expected: string[] = ["", "", "", "alpha"];
const own: boolean[] = [false, false, true, true];
class Holder { static value: Error; }
for (let index = 0; index < inputs.length; index++) {
  Holder.value = inputs[index];
  const value: Error = Holder.value;
  assert.sameValue(value.name, "RangeError");
  assert.sameValue(value.message, expected[index]);
  assert.sameValue(Object.hasOwn(value, "message"), own[index]);
}
console.log("construction-message-static-field:ok");
