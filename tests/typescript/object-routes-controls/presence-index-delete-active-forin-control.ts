/*---
description: "Control for presence-index-delete-active-forin; Deleting an unvisited index-signature property changes live for-in visits without changing an earlier keys snapshot."
features: [ts-object-routes, ts-object-route-presence, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-tuples, ts-closures, ts-literal-types]
---*/
// A typed alias deletes numeric or named keys during traversal of mixed data/getter shapes; node skips the deleted getter, retains snapshot order and exposes absence through the alias. The control uses explicit names, stored values and presence flags.
type ObjectValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, other = { id: 7 };
const samples: [ObjectValue, string][] = [[-0, "0"], [NaN, "null"], ["", '""'], [undefined, ""], [null, "null"], [false, "false"], [marker, '{"id":7}'], [other, '{"id":7}']];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type ShapeMode = "empty" | "data" | "undefined" | "getter";
function inspect(input: ObjectValue, mode: ShapeMode, remove: "none" | "10" | "tail"): void {
  const log: unknown[] = [], source = { two: other, ten: input, tail: mode === "undefined" ? undefined : input, text: "", hasTen: mode !== "empty", hasTail: mode !== "empty", getter: mode === "getter", names: mode === "empty" ? [] : ["2", "10", "tail", "01"] };
  function read(key: string): ObjectValue { if (key === "2") return source.two; if (key === "01") return source.text; if (key === "10") return source.hasTen ? source.ten : undefined; if (!source.hasTail) return undefined; if (source.getter) log.push("get.tail", source.tail); return source.tail; }
  const alias = source, names = mode === "empty" ? [] : ["2", "10", "tail", "01"];
  const snapshot = source.names.slice(); assert.compareArray(snapshot, names); same(alias, source);
  const visited: string[] = [], values: ObjectValue[] = [];
  for (const key of snapshot) {
    if (key === "10" && !source.hasTen) continue; if (key === "tail" && !source.hasTail) continue;
    const value = read(key); visited.push(key); values.push(value); log.push("visit", key, value);
    if (key === "2" && remove !== "none") { if (remove === "10") alias.hasTen = false; else alias.hasTail = false; const result = true; log.push("delete", remove, result); same(result, true); }
  }
  const finalNames = names.filter(key => key !== remove), keys = alias.names.filter(key => key === "10" ? alias.hasTen : key === "tail" ? alias.hasTail : true);
  assert.compareArray(snapshot, names); assert.compareArray(visited, finalNames); assert.compareArray(keys, finalNames);
  const expected: unknown[] = [], expectedValues: ObjectValue[] = [];
  for (const key of finalNames) {
    const value = key === "2" ? other : key === "01" ? "" : key === "tail" && mode === "undefined" ? undefined : input;
    if (key === "tail" && mode === "getter") expected.push("get.tail", input); expected.push("visit", key, value); expectedValues.push(value);
    if (key === "2" && remove !== "none") expected.push("delete", remove, true);
  }
  for (let i = 0; i < values.length; i++) same(values[i], expectedValues[i]);
  if (remove !== "none") { same(read(remove), undefined); const exists = remove === "10" ? alias.hasTen : alias.hasTail; same(exists, false); same(exists, false); }
  assert.compareArray(log, expected);
}
const modes: ShapeMode[] = ["empty", "data", "undefined", "getter"], removals: ("none" | "10" | "tail")[] = ["none", "10", "tail"];
for (const sample of samples) for (const mode of modes) for (const remove of removals) inspect(sample[0], mode, remove);
