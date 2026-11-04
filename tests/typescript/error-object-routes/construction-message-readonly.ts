/*---
description: "A readonly error array distinguishes omitted and undefined messages from own empty and nonempty messages."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-readonly, ts-numbers]
flags: [module]
---*/
// A readonly error array distinguishes omitted and undefined messages from own empty and nonempty messages. Route: a readonly Error array.
// Node prints: construction-message-readonly:ok
const inputs: readonly Error[] = [new ReferenceError(), new ReferenceError(undefined), new ReferenceError(""), new ReferenceError("alpha")];
const expected: string[] = ["", "", "", "alpha"];
const own: boolean[] = [false, false, true, true];
for (let index = 0; index < inputs.length; index++) {
  const value: Error = inputs[index];
  assert.sameValue(value.message, expected[index]);
  assert.sameValue(Object.hasOwn(value, "message"), own[index]);
}
console.log("construction-message-readonly:ok");
