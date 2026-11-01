/*---
description: "Control for objects-record-computed-default-rest; explicit reads preserve the same order, effects and values."
features: [ts-destructuring-routes, ts-destructuring-route-objects, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-interfaces, ts-index-signatures, ts-record, ts-arrow-functions]
---*/
// Explicit reads replace the object pattern; the same typed source, inputs, hook log and exact observations remain.
type PatternValue = number | string | bigint | boolean | undefined | null | { id: number };
const marker = { id: 7 }, fallbackValue = { id: 99 };
const inputs: PatternValue[] = [-0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
interface PatternDictionary { [key: string]: PatternValue; }
function choose(key: string): string { log.push("key", key); return key; }
function fallback(): PatternValue { log.push("default", fallbackValue); return fallbackValue; }
function inspect(source: PatternDictionary, key: string, input: PatternValue): void {
  const selected = choose(key), readSelected = source[selected]; const chosen = readSelected === undefined ? fallback() : readSelected;
  const rest: Record<string, PatternValue> = {};
  for (const name of Object.keys(source)) if (name !== selected) rest[name] = source[name];
  same(chosen, input === undefined ? fallbackValue : input); same(typeof rest, "object"); same(Object.is(rest, source), false);
  const expectedKeys = ["2", "10", "01", "drop", "tail"].filter(name => name !== key);
  assert.compareArray(Object.keys(rest), expectedKeys); same(key in rest, false);
  for (const name of expectedKeys) same(rest[name], name === "10" ? marker : name === "tail" ? null : input);
  const expected: unknown[] = ["key", key]; if (input === undefined) expected.push("default", fallbackValue);
  assert.compareArray(log, expected); assert.compareArray(Object.keys(source), ["2", "10", "01", "drop", "tail"]);
}
for (const input of inputs) for (const key of ["2", "01", "drop"]) {
  log.length = 0; const source: Record<string, PatternValue> = { "01": input, "10": marker, "2": input, drop: input, tail: null };
  inspect(source, key, input);
}
