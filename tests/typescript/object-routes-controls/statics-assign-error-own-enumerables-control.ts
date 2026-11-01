/*---
description: "Control for statics-assign-error-own-enumerables; Object.assign copies an Error subclass through a structural view without its own nonenumerables or inherited accessor."
features: [ts-object-routes, ts-object-route-statics, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-iteration, ts-class, ts-class-fields, ts-inheritance, ts-private-fields, ts-accessors, ts-errors, ts-record, ts-keyof, ts-optional-properties]
---*/
// AssignError and ExtraAssignError cross AssignPublic with numeric fields and optional own undefined; node returns the target with only enumerable data and never calls the prototype getter. The control writes the operation explicitly.
type StaticValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: StaticValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type AssignPublic = { "2": StaticValue; tail: StaticValue; maybe?: StaticValue };
class AssignError extends Error {
  "2": StaticValue; tail: StaticValue; #log: unknown[];
  constructor(value: StaticValue, log: unknown[]) { super("hidden message"); this["2"] = value; this.tail = replacement; this.#log = log; }
  get inherited(): StaticValue { this.#log.push("inherited", this["2"]); return this["2"]; }
}
class ExtraAssignError extends AssignError { maybe: StaticValue = undefined; }
function inspect(input: StaticValue): void {
  const log: unknown[] = [];
  const rows: { value: AssignPublic; keys: (keyof AssignPublic)[]; values: StaticValue[] }[] = [
    { value: new AssignError(input, log), keys: ["2", "tail"], values: [input, replacement] },
    { value: new ExtraAssignError(input, log), keys: ["2", "tail", "maybe"], values: [input, replacement, undefined] }
  ];
  for (const row of rows) {
    log.length = 0; const target: Record<string, StaticValue> = { start: marker };
    for (const key of row.keys) target[key] = row.value[key];
    const actual = target, keys = ["2", "start", "tail"], values: StaticValue[] = [input, marker, replacement], walked: string[] = [];
    if (row.keys.length === 3) { keys.push("maybe"); values.push(undefined); }
    for (const key in actual) walked.push(key);
    same(actual, target); assert.compareArray(Object.keys(actual), keys); assert.compareArray(walked, keys);
    for (let i = 0; i < keys.length; i++) same(actual[keys[i]], values[i]);
    for (const key of ["message", "stack", "inherited"]) same(Object.hasOwn(actual, key), false);
    same("inherited" in actual, false); assert.compareArray(log, []);
  }
}
for (const input of inputs) inspect(input);
