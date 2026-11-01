/*---
description: Control for mapped-partial-optional-presence; begin with the type used for reads.
features: [ts-record-routes, ts-record-mapped, ts-functions, ts-iteration, ts-objects, ts-record, ts-index-signatures, ts-arrays, ts-tuples, ts-unions, ts-typeof-operator, ts-mapped-types, ts-utility-types, ts-type-operators, ts-numbers, ts-strings, ts-null-undefined, ts-optional-properties]
---*/
// Only the source declaration becomes Partial<Record<string, RecordValue>> from creation; optional branches, inputs, writes and all assertions remain identical.
type RecordValue = number | string | boolean | undefined | null | { id: number } | number[];
type RouteKey = "2" | "10" | "01" | "-1" | "4294967295" | "label";
const allKeys: RouteKey[] = ["2", "10", "01", "-1", "4294967295", "label"];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const rows: [boolean, RecordValue, RecordValue][] = [[false, -0, NaN], [true, "text", false], [true, null, undefined], [false, { id: 7 }, [8, 9]]];
for (const [present, first, second] of rows) {
  const source: Partial<Record<string, RecordValue>> = present ? { "10": first, "2": second, "01": first, "-1": second, "4294967295": first, label: second } :
    { "10": first, "2": second, "01": first, "-1": second, "4294967295": first };
  const view: Partial<Record<string, RecordValue>> = source;
  assert.sameValue(view, source);
  for (const written of [false, true]) {
    if (written) view.label = first;
    const expected: RecordValue[] = [second, first, first, second, first, written ? first : present ? second : undefined];
    const keys = present || written ? allKeys : allKeys.slice(0, 5);
    const constants: unknown[][] = [[source["2"], source["10"], source["01"], source["-1"], source["4294967295"], source["label"]],
      [view["2"], view["10"], view["01"], view["-1"], view["4294967295"], view["label"]]];
    const computed: unknown[][] = [[], []];
    for (const key of allKeys) { computed[0].push(source[key]); computed[1].push(view[key]); }
    const values: unknown[][] = [Object.values(source), Object.values(view)];
    const entries: [string, unknown][][] = [Object.entries(source), Object.entries(view)];
    assert.compareArray(Object.keys(source), keys); assert.compareArray(Object.keys(view), keys);
    for (let route = 0; route < 2; route++) {
      assert.sameValue(values[route].length, keys.length); assert.sameValue(entries[route].length, keys.length);
      for (let i = 0; i < allKeys.length; i++) { same(constants[route][i], expected[i]); same(computed[route][i], expected[i]); }
      for (let i = 0; i < keys.length; i++) {
        assert.sameValue(entries[route][i].length, 2); same(values[route][i], expected[i]);
        same(entries[route][i][0], keys[i]); same(entries[route][i][1], expected[i]);
      }
    }
    for (const key of keys) { assert.sameValue(key in source, true); assert.sameValue(key in view, true); }
    same(source.label, expected[5]); same(view.label, expected[5]);
    assert.sameValue("label" in source, present || written); assert.sameValue("label" in view, present || written);
    assert.sameValue("missing" in source, false); assert.sameValue("missing" in view, false);
  }
}
