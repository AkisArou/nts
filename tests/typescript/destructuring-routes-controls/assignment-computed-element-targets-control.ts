/*---
description: "Control for assignment-computed-element-targets; Computed object assignment orders source keys, array target indices, getters and defaults."
features: [ts-destructuring-routes, ts-destructuring-route-assignment, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-unions, ts-type-aliases, ts-unknown, ts-typeof-operator, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-interfaces, ts-accessors]
---*/
// Explicit reads keep the same inputs, protocol/default/getter log and observations. Evaluate each source key and target index once, then read and assign with an explicit undefined test.
type AssignValue = number | string | bigint | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: AssignValue[] = [0, -0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface AssignSource { first: AssignValue; second: AssignValue; }
for (const input of inputs) {
  const log: unknown[] = [], output: AssignValue[] = ["old-first", "old-second", marker];
  const source: AssignSource = { get first() { log.push("get", "first", input); return input; }, get second() { log.push("get", "second", marker); return marker; } };
  function key(name: "first" | "second"): "first" | "second" { log.push("key", name); return name; }
  function index(value: number): number { log.push("index", value); return value; }
  function fallback(): AssignValue { log.push("default", replacement); return replacement; }
  const firstKey = key("first"), firstIndex = index(0), first = source[firstKey]; output[firstIndex] = first === undefined ? fallback() : first;
  const secondKey = key("second"), secondIndex = index(1); output[secondIndex] = source[secondKey];
  same(output.length, 3); same(output[0], input === undefined ? replacement : input); same(output[1], marker); same(output[2], marker);
  const expected: unknown[] = ["key", "first", "index", 0, "get", "first", input];
  if (input === undefined) expected.push("default", replacement);
  expected.push("key", "second", "index", 1, "get", "second", marker); assert.compareArray(log, expected);
}
