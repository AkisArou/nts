/*---
description: "A computed object binding selects and excludes a typed dictionary key while preserving numeric-key ordering."
features: [ts-destructuring-routes, ts-destructuring-route-objects, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-interfaces, ts-index-signatures, ts-record, ts-arrow-functions, ts-computed-keys, ts-destructuring, ts-spread]
---*/
// Pattern { [choose(key)]: chosen = fallback(), ...rest } crosses Record to an index signature; node evaluates the key once and copies the other keys in order.
type PatternValue = number | string | bigint | boolean | undefined | null | { id: number };
const marker = { id: 7 }, fallbackValue = { id: 99 };
const inputs: PatternValue[] = [-0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const log: unknown[] = [];
interface PatternDictionary { [key: string]: PatternValue; }
function choose(key: string): string { log.push("key", key); return key; }
function fallback(): PatternValue { log.push("default", fallbackValue); return fallbackValue; }
function inspect(source: PatternDictionary, key: string, input: PatternValue): void {
  const { [choose(key)]: chosen = fallback(), ...rest } = source;
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
