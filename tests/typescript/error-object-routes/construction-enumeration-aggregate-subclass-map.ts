/*---
description: "An AggregateError subclass exposes its own data field while message, cause and errors stay hidden in all four enumeration forms."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-class, ts-class-fields, ts-this, ts-inheritance, ts-builtin-subclass, ts-map-set, ts-narrowing, ts-null-undefined, ts-objects, ts-spread, ts-unknown, ts-numbers]
flags: [module]
---*/
// An AggregateError subclass exposes its own data field while message, cause and errors stay hidden in all four enumeration forms. Route: a guarded Map.get value holding an AggregateError subclass.
// Node prints: construction-enumeration-aggregate-subclass-map:ok
class PayloadError extends AggregateError {
  code: number;
  constructor(items: Iterable<unknown>, message: string, cause: unknown, code: number) {
    super(items, message, { cause }); this.code = code;
  }
}
const marker = { id: 10 };
const values: Map<string, PayloadError> = new Map([
  ["a", new PayloadError([1], "one", undefined, 1)], ["b", new PayloadError([marker, 2], "two", marker, 2)],
]);
const keys: string[] = ["a", "b"], expectedJSON: string[] = ["{\"code\":1}", "{\"code\":2}"];
for (let index = 0; index < keys.length; index++) {
  const value = values.get(keys[index]); if (value === undefined) throw "missing error";
  const copy = { ...value }, walked: string[] = [];
  for (const key in value) walked.push(key);
  for (const own of ["message", "cause", "errors"]) assert.sameValue(Object.hasOwn(value, own), true);
  assert.compareArray(Object.keys(value), ["code"]);
  assert.sameValue(JSON.stringify(value), expectedJSON[index]);
  assert.compareArray(Object.keys(copy), ["code"]);
  assert.sameValue(copy.code, index + 1);
  assert.compareArray(walked, ["code"]);
}
console.log("construction-enumeration-aggregate-subclass-map:ok");
