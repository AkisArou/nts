/*---
description: "Control for objects-array-index-length-rest; explicit reads preserve the same order, effects and values."
features: [ts-destructuring-routes, ts-destructuring-route-objects, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-record]
---*/
// Explicit reads replace the object pattern; the same typed source, inputs, hook log and exact observations remain.
type PatternValue = number | string | bigint | boolean | undefined | null | { id: number };
const marker = { id: 7 }, fallbackValue = { id: 99 };
const inputs: PatternValue[] = [-0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
function fallback(): PatternValue { log.push("default.third", fallbackValue); return fallbackValue; }
function inspect(source: PatternValue[], input: PatternValue, size: number): void {
  const head = source[0], readThird = source[2]; const third = readThird === undefined ? fallback() : readThird; const count = source.length;
  const rest: Record<string, PatternValue> = {};
  for (const key of Object.keys(source)) if (key !== "0" && key !== "2") rest[key] = source[Number(key)];
  const expectedThird = size === 4 && input !== undefined ? input : fallbackValue;
  same(head, input); same(third, expectedThird); same(count, size); same(typeof rest, "object"); same(Object.is(rest, source), false);
  const keys = size === 1 ? [] : size === 2 ? ["1"] : ["1", "3"];
  assert.compareArray(Object.keys(rest), keys); same("0" in rest, false); same("2" in rest, false); same("length" in rest, false);
  if (size >= 2) same(rest[1], marker); if (size === 4) same(rest[3], false);
  assert.compareArray(log, size === 4 && input !== undefined ? [] : ["default.third", fallbackValue]);
}
for (const input of inputs) for (const size of [1, 2, 4]) {
  log.length = 0; const source: PatternValue[] = [input];
  if (size >= 2) source.push(marker); if (size === 4) source.push(input, false);
  inspect(source, input, size);
}
