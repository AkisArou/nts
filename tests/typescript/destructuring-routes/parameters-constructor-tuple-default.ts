/*---
description: "A constructor tuple parameter binds optional slots after reading an earlier log parameter and preserves both fields."
features: [ts-destructuring-routes, ts-destructuring-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-destructuring, ts-class, ts-class-fields, ts-tuples, ts-tuple-optional, ts-instanceof]
---*/
// A constructor receives [first?, second?]; node defaults only first and writes both bound values into declared fields.
type ParameterValue = number | string | bigint | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: ParameterValue[] = [-0, 0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type ParameterTuple = [ParameterValue?, ParameterValue?];
function fallback(log: unknown[]): ParameterValue { log.push("default", replacement); return replacement; }
class ParameterCapture {
  first: ParameterValue; second: ParameterValue;
  constructor(log: unknown[], [first = fallback(log), second]: ParameterTuple) {
    log.push("body", first, second); this.first = first; this.second = second;
  }
}
for (const input of inputs) for (const mode of [0, 1, 2]) {
  const log: unknown[] = [], source: ParameterTuple = mode === 0 ? [] : mode === 1 ? [input] : [input, marker];
  const result = new ParameterCapture(log, source), wanted = mode === 0 || input === undefined ? replacement : input, second = mode === 2 ? marker : undefined;
  same(result.first, wanted); same(result.second, second); same(result instanceof ParameterCapture, true);
  const expected: unknown[] = mode === 0 || input === undefined ? ["default", replacement] : [];
  expected.push("body", wanted, second); assert.compareArray(log, expected);
}
