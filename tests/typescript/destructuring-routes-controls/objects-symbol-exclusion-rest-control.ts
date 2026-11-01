/*---
description: "Control for objects-symbol-exclusion-rest; explicit reads preserve the same order, effects and values."
features: [ts-destructuring-routes, ts-destructuring-route-objects, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-interfaces, ts-symbols, ts-computed-keys, ts-accessors, ts-index-signatures]
---*/
// Explicit reads replace the object pattern; the same typed source, inputs, hook log and exact observations remain.
type PatternValue = number | string | bigint | boolean | undefined | null | { id: number };
const marker = { id: 7 }, fallbackValue = { id: 99 };
const inputs: PatternValue[] = [-0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const removedKey = Symbol("removed"), keptKey = Symbol("kept"), log: unknown[] = [];
interface PatternSymbols { [removedKey]: PatternValue; [keptKey]: PatternValue; "2": object; "10": boolean; label: string; }
function inspect(source: PatternSymbols, input: PatternValue): void {
  const chosen = source[removedKey]; const rest: { [key: string]: unknown; [key: symbol]: unknown } = {};
  for (const key of Object.keys(source)) if (key === "2" || key === "10" || key === "label") rest[key] = source[key];
  for (const key of Object.getOwnPropertySymbols(source)) if (key === keptKey) rest[key] = source[keptKey];
  same(chosen, input); same(rest[keptKey], input); same(rest[2], marker); same(rest[10], false); same(rest.label, "");
  same(typeof rest, "object"); same(Object.is(rest, source), false); same(removedKey in rest, false);
  assert.compareArray(Object.keys(rest), ["2", "10", "label"]); assert.compareArray(Object.getOwnPropertySymbols(rest), [keptKey]);
  same(rest[keptKey], input); assert.compareArray(log, ["get.symbol", input]);
}
for (const input of inputs) {
  log.length = 0;
  const source: PatternSymbols = { label: "", "10": false, [removedKey]: input, "2": marker,
    get [keptKey](): PatternValue { log.push("get.symbol", input); return input; }
  };
  inspect(source, input);
}
