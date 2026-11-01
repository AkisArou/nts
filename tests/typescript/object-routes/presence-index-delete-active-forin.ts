/*---
description: "Deleting an unvisited index-signature property changes live for-in visits without changing an earlier keys snapshot."
features: [ts-object-routes, ts-object-route-presence, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-tuples, ts-interfaces, ts-index-signatures, ts-accessors, ts-closures, ts-expressions, ts-literal-types]
---*/
// A typed alias deletes numeric or named keys during traversal of mixed data/getter shapes; node skips the deleted getter, retains snapshot order and exposes absence through the alias.
type ObjectValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, other = { id: 7 };
const samples: [ObjectValue, string][] = [[-0, "0"], [NaN, "null"], ["", '""'], [undefined, ""], [null, "null"], [false, "false"], [marker, '{"id":7}'], [other, '{"id":7}']];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface PresenceView { [key: string]: ObjectValue; }
type ShapeMode = "empty" | "data" | "undefined" | "getter";
function inspect(input: ObjectValue, mode: ShapeMode, remove: "none" | "10" | "tail"): void {
  const log: unknown[] = []; let source: PresenceView = {};
  if (mode !== "empty") source = { "10": input, "2": other, tail: mode === "undefined" ? undefined : input, "01": "" };
  if (mode === "getter") source = { "10": input, "2": other, get tail(): ObjectValue { log.push("get.tail", input); return input; }, "01": "" };
  const alias: PresenceView = source, names = mode === "empty" ? [] : ["2", "10", "tail", "01"];
  const snapshot = Object.keys(source); assert.compareArray(snapshot, names); same(alias, source);
  const visited: string[] = [], values: ObjectValue[] = [];
  for (const key in source) {
    const value = source[key]; visited.push(key); values.push(value); log.push("visit", key, value);
    if (key === "2" && remove !== "none") { const result = delete alias[remove]; log.push("delete", remove, result); same(result, true); }
  }
  const finalNames = names.filter(key => key !== remove), keys = Object.keys(alias);
  assert.compareArray(snapshot, names); assert.compareArray(visited, finalNames); assert.compareArray(keys, finalNames);
  const expected: unknown[] = [], expectedValues: ObjectValue[] = [];
  for (const key of finalNames) {
    const value = key === "2" ? other : key === "01" ? "" : key === "tail" && mode === "undefined" ? undefined : input;
    if (key === "tail" && mode === "getter") expected.push("get.tail", input); expected.push("visit", key, value); expectedValues.push(value);
    if (key === "2" && remove !== "none") expected.push("delete", remove, true);
  }
  for (let i = 0; i < values.length; i++) same(values[i], expectedValues[i]);
  if (remove !== "none") { same(alias[remove], undefined); same(remove in alias, false); same(Object.hasOwn(alias, remove), false); }
  assert.compareArray(log, expected);
}
const modes: ShapeMode[] = ["empty", "data", "undefined", "getter"], removals: ("none" | "10" | "tail")[] = ["none", "10", "tail"];
for (const sample of samples) for (const mode of modes) for (const remove of removals) inspect(sample[0], mode, remove);
