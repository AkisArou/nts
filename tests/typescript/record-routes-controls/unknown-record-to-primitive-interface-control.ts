/*---
description: Control for unknown-record-to-primitive-interface; declare the source in its read type from construction.
features: [ts-record-routes, ts-record-unknown, ts-unknown, ts-narrowing, ts-record, ts-index-signatures, ts-objects, ts-functions, ts-arrays, ts-iteration, ts-typeof-operator, ts-numbers, ts-strings, ts-null-undefined, ts-interfaces, ts-type-guards, ts-intersections, ts-tuples]
---*/
// Declare the source as Record<string, unknown> & RecordFace from construction; every field check, write and assertion is identical.
interface RecordFace { "2": number; "10": number; "01": string; "-1": boolean; "4294967295": null; tail: number; }
function isFace(value: Record<string, unknown>): value is Record<string, unknown> & RecordFace {
  return typeof value["2"] === "number" && typeof value["10"] === "number" && typeof value["01"] === "string" &&
    typeof value["-1"] === "boolean" && value["4294967295"] === null && typeof value.tail === "number";
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
const rows: [number, string, boolean][] = [[-0, "first", true], [NaN, "second", false], [2.5, "third", true]];
for (const [n, label, active] of rows) {
  const source: Record<string, unknown> & RecordFace = { "10": n, "2": n + 1, "01": label, "-1": active, "4294967295": null, tail: n };
  const view = source;
  if (!isFace(view)) throw new Error("face");
  const expected: unknown[] = [n + 1, n, label, active, null, n];
  inspect(view, expected);
  view.tail = label.length; expected[5] = label.length; inspect(view, expected);
  assert.sameValue(Object.is(source.tail, label.length), true); assert.sameValue(typeof source.tail, "number");
  assert.sameValue(Object.is(view, source), true);
}
