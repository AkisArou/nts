/*---
description: "All eight native error kinds hide message and cause, and AggregateError also hides errors, in all four enumeration forms."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-readonly, ts-function-types, ts-arrow-functions, ts-objects, ts-spread, ts-numbers]
flags: [module]
---*/
// All eight native error kinds hide message and cause, and AggregateError also hides errors, in all four enumeration forms. Route: a readonly array of typed native factories.
// Node prints: construction-enumeration-native-factories:ok
const marker = { id: 8 };
const makers: readonly (() => Error)[] = [
  () => new Error("native", { cause: marker }),
  () => new TypeError("native", { cause: marker }),
  () => new RangeError("native", { cause: marker }),
  () => new SyntaxError("native", { cause: marker }),
  () => new ReferenceError("native", { cause: marker }),
  () => new EvalError("native", { cause: marker }),
  () => new URIError("native", { cause: marker }),
  () => new AggregateError([marker], "native", { cause: marker })
];
const names: string[] = ["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "EvalError", "URIError", "AggregateError"];
for (let index = 0; index < makers.length; index++) {
  const value: Error = makers[index](), copy = { ...value }, walked: string[] = [];
  for (const key in value) walked.push(key);
  assert.sameValue(value.name, names[index]);
  assert.sameValue(Object.hasOwn(value, "message"), true);
  assert.sameValue(Object.hasOwn(value, "cause"), true);
  assert.sameValue(Object.hasOwn(value, "errors"), index === 7);
  assert.compareArray(Object.keys(value), []);
  assert.sameValue(JSON.stringify(value), "{}");
  assert.compareArray(Object.keys(copy), []);
  assert.compareArray(walked, []);
}
console.log("construction-enumeration-native-factories:ok");
