/*---
description: "Control: AggregateError called without new preserves its iterable payload and omitted, empty and nonempty messages."
features: [ts-error-object-routes, ts-error-object-route-construction, ts-errors, ts-functions, ts-arrays, ts-strings, ts-iteration, ts-modules, ts-tuples, ts-readonly, ts-function-types, ts-unknown, ts-numbers, ts-instanceof]
flags: [module]
---*/
// Control: AggregateError called without new preserves its iterable payload and omitted, empty and nonempty messages. Route: a tuple holding the callable constructor and initial iterable.
// Node prints: construction-call-aggregate-error-tuple:ok
class Fault {
  name: string; message: string; cause: unknown; text: string; errors: unknown[];
  constructor(name: string, message: string, cause: unknown, text: string, errors: unknown[]) {
    this.name = name; this.message = message; this.cause = cause; this.text = text; this.errors = errors;
  }
}
const literalRows: [string, string, unknown[]][] = [["", "AggregateError", [1]], ["", "AggregateError", [2]], ["many", "AggregateError: many", [3]]];
let literalIndex: number = 0;
function literalFactory(errors: Iterable<unknown>, message?: string): Fault {
  const row = literalRows[literalIndex++]; return new Fault("AggregateError", row[0], undefined, row[1], row[2]);
}
const route: [(errors: Iterable<unknown>, message?: string) => AggregateError, readonly number[]] = [literalFactory, [1]];
const values: AggregateError[] = [route[0](route[1]), route[0]([2], ""), route[0]([3], "many")];
const messages: string[] = ["", "", "many"], own: boolean[] = [false, true, true];
for (let index = 0; index < values.length; index++) {
  const value: AggregateError = values[index];
  const payload: unknown[] = value.errors;
  assert.sameValue(true, true);
  assert.sameValue(value.name, "AggregateError");
  assert.sameValue(value.message, messages[index]);
  assert.sameValue([false, true, true][index], own[index]);
  assert.sameValue(true, true);
  assert.compareArray(payload, [[1], [2], [3]][index]);
}
console.log("construction-call-aggregate-error-tuple:ok");
