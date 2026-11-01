/*---
description: Control for short-computed-key-value-order; Computed literal-union keys mutate the typed state before each corresponding property value is evaluated.
features: [ts-control-flow-routes, ts-control-flow-route-short-circuit, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-expressions, ts-tuples, ts-closures, ts-index-signatures, ts-computed-keys, ts-literal-types]
---*/
// RouteKey and ShortValue flow into a computed object literal; node evaluates each key before its value and preserves both property insertion orders. The control spells the tested evaluation out in ordered steps.
type ShortValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const rows: [ShortValue, boolean, boolean][] = [[0, false, false], [-0, false, false], [NaN, false, false], ["", false, false], [undefined, false, true], [null, false, true], [false, false, false], [marker, true, false], [7, true, false], ["go", true, false], [true, true, false], [replacement, true, false]];
type RouteKey = "first" | "second";
const orders: [RouteKey, RouteKey][] = [["first", "second"], ["second", "first"]];
function inspect(input: ShortValue, firstKey: RouteKey, secondKey: RouteKey): void {
  const log: unknown[] = []; let state: ShortValue = input;
  function key(value: RouteKey, next: ShortValue): RouteKey { log.push("key", value, state, "write", next); state = next; return value; }
  function value(): ShortValue { log.push("value", state); return state; }
  const actual: { [key: string]: ShortValue } = {}; const a = key(firstKey, replacement); actual[a] = value(); const b = key(secondKey, input); actual[b] = value();
  same(actual[firstKey], replacement); same(actual[secondKey], input); same(state, input); assert.compareArray(Object.keys(actual), [firstKey, secondKey]);
  assert.compareArray(log, ["key", firstKey, input, "write", replacement, "value", replacement, "key", secondKey, replacement, "write", input, "value", input]);
}
for (const row of rows) for (const order of orders) inspect(row[0], order[0], order[1]);
