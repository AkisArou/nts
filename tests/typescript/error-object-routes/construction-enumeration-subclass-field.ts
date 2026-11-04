/*---
description: "An Error subclass enumerates only its ordered data fields while message and cause stay hidden in all four forms."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-class, ts-class-fields, ts-this, ts-inheritance, ts-builtin-subclass, ts-objects, ts-spread, ts-unknown, ts-numbers]
flags: [module]
---*/
// An Error subclass enumerates only its ordered data fields while message and cause stay hidden in all four forms. Route: a class field holding a data-bearing Error subclass.
// Node prints: construction-enumeration-subclass-field:ok
class DataError extends Error {
  code: number; tag: string;
  constructor(message: string, cause: unknown, code: number, tag: string) {
    super(message, { cause }); this.code = code; this.tag = tag;
  }
}
class Holder { value: DataError; constructor(value: DataError) { this.value = value; } }
const marker = { id: 9 };
const inputs: DataError[] = [new DataError("", undefined, 1, "a"), new DataError("message", marker, 2, "b")];
const holder = new Holder(inputs[0]);
const expectedJSON: string[] = ["{\"code\":1,\"tag\":\"a\"}", "{\"code\":2,\"tag\":\"b\"}"];
for (let index = 0; index < inputs.length; index++) {
  holder.value = inputs[index]; const value: DataError = holder.value;
  const copy = { ...value }, walked: string[] = [];
  for (const key in value) walked.push(key);
  assert.sameValue(Object.hasOwn(value, "message"), true);
  assert.sameValue(Object.hasOwn(value, "cause"), true);
  assert.compareArray(Object.keys(value), ["code", "tag"]);
  assert.sameValue(JSON.stringify(value), expectedJSON[index]);
  assert.compareArray(Object.keys(copy), ["code", "tag"]);
  assert.sameValue(copy.code, index + 1); assert.sameValue(copy.tag, ["a", "b"][index]);
  assert.compareArray(walked, ["code", "tag"]);
}
console.log("construction-enumeration-subclass-field:ok");
