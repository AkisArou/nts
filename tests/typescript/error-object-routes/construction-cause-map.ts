/*---
description: "Absent and empty options omit cause; explicit undefined and falsy causes are own properties, and object causes retain identity."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-map-set, ts-narrowing, ts-null-undefined, ts-unknown, ts-objects, ts-numbers]
flags: [module]
---*/
// Absent and empty options omit cause; explicit undefined and falsy causes are own properties, and object causes retain identity. Route: a guarded Map.get value.
// Node prints: construction-cause-map:ok
const first = { id: 1 }, second = { id: 2 };
const inputs: Error[] = [new SyntaxError("m"), new SyntaxError("m", undefined), new SyntaxError("m", {}), new SyntaxError("m", { cause: undefined }), new SyntaxError("m", { cause: first }), new SyntaxError("m", { cause: second }), new SyntaxError("m", { cause: 0 }), new SyntaxError("m", { cause: false }), new SyntaxError("m", { cause: null })];
const expected: unknown[] = [undefined, undefined, undefined, undefined, first, second, 0, false, null];
const own: boolean[] = [false, false, false, true, true, true, true, true, true];
const slots: Map<number, Error> = new Map();
for (let index = 0; index < inputs.length; index++) {
  slots.set(index, inputs[index]);
  const selected = slots.get(index); if (selected === undefined) throw "missing error";
  const value: Error = selected;
  assert.sameValue(value.cause, expected[index]);
  assert.sameValue(Object.hasOwn(value, "cause"), own[index]);
}
console.log("construction-cause-map:ok");
