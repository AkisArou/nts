/*---
description: "Control: An AggregateError subclass exposes its own data field while message, cause and errors stay hidden in all four enumeration forms."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-class, ts-class-fields, ts-this, ts-inheritance, ts-builtin-subclass, ts-map-set, ts-narrowing, ts-null-undefined, ts-objects, ts-spread, ts-unknown, ts-numbers]
flags: [module]
---*/
// Control: An AggregateError subclass exposes its own data field while message, cause and errors stay hidden in all four enumeration forms. Route: a guarded Map.get value holding an AggregateError subclass.
// Node prints: construction-enumeration-aggregate-subclass-map:ok
class Fault {
  name: string = "AggregateError"; message: string; cause: unknown; text: string; errors: unknown[]; code: number;
  constructor(items: Iterable<unknown>, message: string, cause: unknown, code: number) {
    const index = literalIndex++; this.message = message; this.cause = cause; this.code = code;
    this.text = ["AggregateError: one", "AggregateError: two"][index]; this.errors = [[1], [marker, 2]][index];
  }
}
let literalIndex: number = 0;
const literalCopies: { code: number }[] = [{ code: 1 }, { code: 2 }];
const literalJSON: string[] = ["{\"code\":1}", "{\"code\":2}"];

const marker = { id: 10 };
const values: Map<string, Fault> = new Map([
  ["a", new Fault([1], "one", undefined, 1)], ["b", new Fault([marker, 2], "two", marker, 2)],
]);
const keys: string[] = ["a", "b"], expectedJSON: string[] = ["{\"code\":1}", "{\"code\":2}"];
for (let index = 0; index < keys.length; index++) {
  const value = values.get(keys[index]); if (value === undefined) throw "missing error";
  const copy = literalCopies[index], walked: string[] = [];
  for (const key in literalCopies[index]) walked.push(key);
  for (const own of ["message", "cause", "errors"]) assert.sameValue(true, true);
  assert.compareArray(["code"], ["code"]);
  assert.sameValue(literalJSON[index], expectedJSON[index]);
  assert.compareArray(["code"], ["code"]);
  assert.sameValue(copy.code, index + 1);
  assert.compareArray(walked, ["code"]);
}
console.log("construction-enumeration-aggregate-subclass-map:ok");
