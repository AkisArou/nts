/*---
description: "A symbol-named object binding excludes exactly its key while rest retains another symbol getter and ordered string keys."
features: [ts-destructuring-routes, ts-destructuring-route-objects, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-interfaces, ts-symbols, ts-computed-keys, ts-accessors, ts-destructuring, ts-spread]
---*/
// Pattern { [removedKey]: chosen, ...rest } reads PatternSymbols; node excludes the chosen symbol, copies numeric/string keys and reads the retained symbol getter once.
type PatternValue = number | string | bigint | boolean | undefined | null | { id: number };
const marker = { id: 7 }, fallbackValue = { id: 99 };
const inputs: PatternValue[] = [-0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const removedKey = Symbol("removed"), keptKey = Symbol("kept"), log: unknown[] = [];
interface PatternSymbols { [removedKey]: PatternValue; [keptKey]: PatternValue; "2": object; "10": boolean; label: string; }
function inspect(source: PatternSymbols, input: PatternValue): void {
  const { [removedKey]: chosen, ...rest } = source;
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
