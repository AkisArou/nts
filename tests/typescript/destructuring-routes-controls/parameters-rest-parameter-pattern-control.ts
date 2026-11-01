/*---
description: "Control for parameters-rest-parameter-pattern; expand the pattern into ordered reads."
features: [ts-destructuring-routes, ts-destructuring-route-parameters, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-rest-parameters, ts-spread]
---*/
// Explicit reads replace the pattern; the same values, effects and assertions hold. A typed ...[head, ...tail] parameter receives zero, one or four arguments; node defaults head and retains all remaining values.
type ParameterValue = number | string | bigint | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: ParameterValue[] = [-0, 0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type ParameterResult = { head: ParameterValue; tail: ParameterValue[] };
for (const input of inputs) for (const mode of [0, 1, 2]) {
  const log: unknown[] = [];
  function fallback(): ParameterValue { log.push("default", replacement); return replacement; }
  function read(...values: ParameterValue[]): ParameterResult {
    const firstRead = values[0], head = firstRead === undefined ? fallback() : firstRead, tail: ParameterValue[] = [];
    for (let index = 1; index < values.length; index++) tail.push(values[index]);
    log.push("body", head, tail.length); return { head, tail };
  }
  const args: ParameterValue[] = mode === 0 ? [] : mode === 1 ? [input] : [input, marker, null, -0];
  const result = read(...args), wanted = mode === 0 || input === undefined ? replacement : input;
  const tail: ParameterValue[] = mode === 2 ? [marker, null, -0] : [];
  same(result.head, wanted); same(result.tail.length, tail.length); same(Array.isArray(result.tail), true); same(typeof result.tail, "object"); same(Object.is(result.tail, args), false);
  assert.compareArray(Object.keys(result.tail), mode === 2 ? ["0", "1", "2"] : []); assert.compareArray(result.tail, tail);
  for (let index = 0; index < tail.length; index++) same(result.tail[index], tail[index]);
  const expected: unknown[] = mode === 0 || input === undefined ? ["default", replacement] : [];
  expected.push("body", wanted, tail.length); assert.compareArray(log, expected);
}
