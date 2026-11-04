/*---
description: "Omitted and undefined messages have no own property; empty and nonempty messages have an own property."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-map-set, ts-narrowing, ts-null-undefined, ts-numbers]
flags: [module]
---*/
// Omitted and undefined messages have no own property; empty and nonempty messages have an own property. Route: a guarded Map.get value.
// Node prints: construction-message-map:ok
const inputs: Error[] = [new SyntaxError(), new SyntaxError(undefined), new SyntaxError(""), new SyntaxError("alpha")];
const expected: string[] = ["", "", "", "alpha"];
const own: boolean[] = [false, false, true, true];
const slots: Map<number, Error> = new Map();
for (let index = 0; index < inputs.length; index++) {
  slots.set(index, inputs[index]);
  const selected = slots.get(index); if (selected === undefined) throw "missing error";
  const value: Error = selected;
  assert.sameValue(value.name, "SyntaxError");
  assert.sameValue(value.message, expected[index]);
  assert.sameValue(Object.hasOwn(value, "message"), own[index]);
}
console.log("construction-message-map:ok");
