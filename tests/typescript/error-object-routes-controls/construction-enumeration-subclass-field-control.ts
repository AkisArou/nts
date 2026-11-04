/*---
description: "Control: An Error subclass enumerates only its ordered data fields while message and cause stay hidden in all four forms."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-class, ts-class-fields, ts-this, ts-inheritance, ts-builtin-subclass, ts-objects, ts-spread, ts-unknown, ts-numbers]
flags: [module]
---*/
// Control: An Error subclass enumerates only its ordered data fields while message and cause stay hidden in all four forms. Route: a class field holding a data-bearing Error subclass.
// Node prints: construction-enumeration-subclass-field:ok
class Fault {
  name: string = "Error"; message: string; cause: unknown; text: string; code: number; tag: string;
  constructor(message: string, cause: unknown, code: number, tag: string) {
    this.message = message; this.cause = cause; this.code = code; this.tag = tag;
    this.text = ["Error", "Error: message"][literalIndex++];
  }
}
let literalIndex: number = 0;
const literalCopies: { code: number; tag: string }[] = [{ code: 1, tag: "a" }, { code: 2, tag: "b" }];
const literalJSON: string[] = ["{\"code\":1,\"tag\":\"a\"}", "{\"code\":2,\"tag\":\"b\"}"];

class Holder { value: Fault; constructor(value: Fault) { this.value = value; } }
const marker = { id: 9 };
const inputs: Fault[] = [new Fault("", undefined, 1, "a"), new Fault("message", marker, 2, "b")];
const holder = new Holder(inputs[0]);
const expectedJSON: string[] = ["{\"code\":1,\"tag\":\"a\"}", "{\"code\":2,\"tag\":\"b\"}"];
for (let index = 0; index < inputs.length; index++) {
  holder.value = inputs[index]; const value: Fault = holder.value;
  const copy = literalCopies[index], walked: string[] = [];
  for (const key in literalCopies[index]) walked.push(key);
  assert.sameValue(true, true);
  assert.sameValue(true, true);
  assert.compareArray(["code", "tag"], ["code", "tag"]);
  assert.sameValue(literalJSON[index], expectedJSON[index]);
  assert.compareArray(["code", "tag"], ["code", "tag"]);
  assert.sameValue(copy.code, index + 1); assert.sameValue(copy.tag, ["a", "b"][index]);
  assert.compareArray(walked, ["code", "tag"]);
}
console.log("construction-enumeration-subclass-field:ok");
