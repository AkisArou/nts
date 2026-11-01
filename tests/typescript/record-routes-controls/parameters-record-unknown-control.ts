/*---
description: Control for parameters-record-unknown; begin with the type used for reads.
features: [ts-record-routes, ts-record-parameters, ts-functions, ts-iteration, ts-objects, ts-record, ts-index-signatures, ts-arrays, ts-tuples, ts-unions, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-null-undefined]
---*/
// Only the source declaration becomes Record<string, RecordValue>; values, calls, writes and all assertions remain identical.
type RecordValue = unknown;
type RouteKey = "2" | "10" | "01" | "-1" | "4294967295" | "label";
const keys: RouteKey[] = ["2", "10", "01", "-1", "4294967295", "label"];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function cross(view: Record<string, RecordValue>, first: RecordValue, second: RecordValue): void {
  for (const written of [false, true]) {
    if (written) view.label = first;
    const expected: RecordValue[] = [second, first, first, second, first, written ? first : second];
    const constants: unknown[] = [view["2"], view["10"], view["01"], view["-1"], view["4294967295"], view["label"]];
    const values: unknown[] = Object.values(view), entries: [string, unknown][] = Object.entries(view);
    assert.compareArray(Object.keys(view), keys);
    assert.sameValue(values.length, keys.length); assert.sameValue(entries.length, keys.length);
    for (let i = 0; i < keys.length; i++) {
      assert.sameValue(entries[i].length, 2);
      const key = keys[i]; assert.sameValue(key in view, true); same(entries[i][0], key);
      same(view[key], expected[i]); same(constants[i], expected[i]);
      same(values[i], expected[i]); same(entries[i][1], expected[i]);
    }
    same(view.label, expected[5]); assert.sameValue("missing" in view, false);
  }
}
const rows: [RecordValue, RecordValue][] = [[-0, NaN], ["text", false], [undefined, null], [{ id: 7 }, [8, 9]]];
for (const [first, second] of rows) {
  const source: Record<string, RecordValue> = { "10": first, "2": second, "01": first, "-1": second, "4294967295": first, label: second };
  cross(source, first, second);
  const expected: RecordValue[] = [second, first, first, second, first, first];
  const constants: unknown[] = [source["2"], source["10"], source["01"], source["-1"], source["4294967295"], source["label"]];
  const values: unknown[] = Object.values(source), entries: [string, unknown][] = Object.entries(source);
  assert.compareArray(Object.keys(source), keys);
  assert.sameValue(values.length, keys.length); assert.sameValue(entries.length, keys.length);
  for (let i = 0; i < keys.length; i++) {
    assert.sameValue(entries[i].length, 2);
    const key = keys[i]; assert.sameValue(key in source, true); same(entries[i][0], key);
    same(source[key], expected[i]); same(constants[i], expected[i]);
    same(values[i], expected[i]); same(entries[i][1], expected[i]);
  }
  same(source.label, expected[5]); assert.sameValue("missing" in source, false);
}
