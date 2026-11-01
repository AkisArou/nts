/*---
description: Control for unknown-record-to-reference-interface; declare the source in its read type from construction.
features: [ts-record-routes, ts-record-unknown, ts-unknown, ts-narrowing, ts-record, ts-index-signatures, ts-objects, ts-functions, ts-arrays, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined, ts-interfaces, ts-type-guards, ts-intersections]
---*/
// Declare the source as Record<string, unknown> & RecordFace from construction; every field check, write and assertion is identical.
interface RecordFace { "2": { id: number }; "10": unknown[]; "01": string; "-1": boolean; "4294967295": undefined; tail: { id: number }; }
function hasId(value: unknown): value is { id: number } {
  return typeof value === "object" && value !== null && "id" in value && typeof value.id === "number";
}
function isFace(value: Record<string, unknown>): value is Record<string, unknown> & RecordFace {
  return hasId(value["2"]) && Array.isArray(value["10"]) && typeof value["01"] === "string" &&
    typeof value["-1"] === "boolean" && "4294967295" in value && value["4294967295"] === undefined && hasId(value.tail);
}
function inspect(value: Record<string, unknown> & RecordFace, expected: unknown[]): void {
  const keys = ["2", "10", "01", "-1", "4294967295", "tail"];
  const fixed = [value["2"], value["10"], value["01"], value["-1"], value["4294967295"], value["tail"]];
  assert.sameValue(Object.is(value.tail, expected[5]), true); assert.sameValue(typeof value.tail, typeof expected[5]);
  const values: unknown[] = Object.values(value), entries: [string, unknown][] = Object.entries(value);
  assert.compareArray(Object.keys(value), keys);
  assert.sameValue(values.length, keys.length); assert.sameValue(entries.length, keys.length);
  for (let i = 0; i < keys.length; i++) {
    assert.sameValue(keys[i] in value, true); assert.compareArray(entries[i], [keys[i], expected[i]]);
    for (const actual of [value[keys[i]], fixed[i], values[i], entries[i][1]]) {
      assert.sameValue(Object.is(actual, expected[i]), true); assert.sameValue(typeof actual, typeof expected[i]);
    }
  }
  assert.sameValue("missing" in value, false);
}
for (const n of [-0, NaN, 2.5]) {
  const item = { id: n }, next = { id: n + 1 }; const list: unknown[] = [n, "x"];
  const source: Record<string, unknown> & RecordFace = { "10": list, "2": item, "01": "ref", "-1": true, "4294967295": undefined, tail: item };
  const view = source;
  if (!isFace(view)) throw new Error("face");
  const expected: unknown[] = [item, list, "ref", true, undefined, item];
  inspect(view, expected);
  view.tail = next; expected[5] = next; inspect(view, expected);
  assert.sameValue(Object.is(source.tail, next), true); assert.sameValue(typeof source.tail, "object");
  assert.sameValue(Object.is(view, source), true);
}
