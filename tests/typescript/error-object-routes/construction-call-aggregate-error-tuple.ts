/*---
description: "AggregateError called without new preserves its iterable payload and omitted, empty and nonempty messages."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-tuples, ts-readonly, ts-function-types, ts-unknown, ts-numbers, ts-instanceof]
flags: [module]
---*/
// AggregateError called without new preserves its iterable payload and omitted, empty and nonempty messages. Route: a tuple holding the callable constructor and initial iterable.
// Node prints: construction-call-aggregate-error-tuple:ok
const route: [(errors: Iterable<unknown>, message?: string) => AggregateError, readonly number[]] = [AggregateError, [1]];
const values: AggregateError[] = [route[0](route[1]), route[0]([2], ""), route[0]([3], "many")];
const messages: string[] = ["", "", "many"], own: boolean[] = [false, true, true];
for (let index = 0; index < values.length; index++) {
  const value: AggregateError = values[index];
  const payload: unknown[] = value.errors;
  assert.sameValue(value instanceof AggregateError, true);
  assert.sameValue(value.name, "AggregateError");
  assert.sameValue(value.message, messages[index]);
  assert.sameValue(Object.hasOwn(value, "message"), own[index]);
  assert.sameValue(Object.hasOwn(value, "errors"), true);
  assert.compareArray(payload, [[1], [2], [3]][index]);
}
console.log("construction-call-aggregate-error-tuple:ok");
