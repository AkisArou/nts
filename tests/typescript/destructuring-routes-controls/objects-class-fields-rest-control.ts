/*---
description: "Control for objects-class-fields-rest; explicit reads preserve the same order, effects and values."
features: [ts-destructuring-routes, ts-destructuring-route-objects, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-class, ts-class-fields, ts-record]
---*/
// Explicit reads replace the object pattern; the same typed source, inputs, hook log and exact observations remain.
type PatternValue = number | string | bigint | boolean | undefined | null | { id: number };
const marker = { id: 7 }, fallbackValue = { id: 99 };
const inputs: PatternValue[] = [-0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
class PatternFields {
  prefix: object = marker; value: PatternValue; tail: boolean = false;
  constructor(value: PatternValue) { this.value = value; }
}
function inspect(source: PatternFields, expected: PatternValue): void {
  const chosen = source.value; const rest: Record<string, unknown> = {};
  for (const key of Object.keys(source)) if (key === "prefix" || key === "tail") rest[key] = source[key];
  same(chosen, expected); same(rest.prefix, marker); same(rest.tail, false);
  same(typeof rest, "object"); same(Object.is(rest, source), false);
  assert.compareArray(Object.keys(rest), ["prefix", "tail"]); same("value" in rest, false);
  assert.compareArray(Object.keys(source), ["prefix", "value", "tail"]);
  same(source.value, expected); same(source.prefix, marker); same(source.tail, false);
}
for (const input of inputs) inspect(new PatternFields(input), input);
