/*---
description: "Control for objects-class-inherited-getters-rest; explicit reads preserve the same order, effects and values."
features: [ts-destructuring-routes, ts-destructuring-route-objects, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-interfaces, ts-class, ts-class-fields, ts-inheritance, ts-accessors, ts-record]
---*/
// Explicit reads replace the object pattern; the same typed source, inputs, hook log and exact observations remain.
type PatternValue = number | string | bigint | boolean | undefined | null | { id: number };
const marker = { id: 7 }, fallbackValue = { id: 99 };
const inputs: PatternValue[] = [-0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
interface PatternView { raw: PatternValue; extra: object; first: PatternValue; second: PatternValue; }
class PatternBase {
  raw: PatternValue; constructor(value: PatternValue) { this.raw = value; }
  get first(): PatternValue { log.push("get.first", this.raw); return this.raw; }
}
class PatternDerived extends PatternBase {
  extra: object = marker;
  get second(): PatternValue { const value = this.raw === undefined ? undefined : false; log.push("get.second", value); return value; }
}
function fallback(): PatternValue { log.push("default.second", fallbackValue); return fallbackValue; }
function inspect(source: PatternView, input: PatternValue): void {
  const readSecond = source.second; const chosen = readSecond === undefined ? fallback() : readSecond; const first = source.first;
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(source)) if (key === "raw" || key === "extra") rest[key] = source[key];
  same(chosen, input === undefined ? fallbackValue : false); same(first, input);
  same(rest.raw, input); same(rest.extra, marker); same(typeof rest, "object"); same(Object.is(rest, source), false);
  assert.compareArray(Object.keys(rest), ["raw", "extra"]); same("first" in rest, false); same("second" in rest, false);
  const expected: unknown[] = ["get.second", input === undefined ? undefined : false];
  if (input === undefined) expected.push("default.second", fallbackValue);
  expected.push("get.first", input); assert.compareArray(log, expected);
}
for (const input of inputs) { log.length = 0; inspect(new PatternDerived(input), input); }
