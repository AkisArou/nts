/*---
description: Control for parameters-number-index-bare-numbers; begin with the type used for reads.
features: [ts-record-routes, ts-record-parameters, ts-functions, ts-iteration, ts-objects, ts-record, ts-index-signatures, ts-arrays, ts-tuples, ts-unions, ts-typeof-operator, ts-numbers]
---*/
// Only the source declaration becomes { [key: number]: RecordValue }; numeric keys, values, calls, writes and every assertion remain identical.
type RecordValue = number;
type NumericKey = 2 | 10 | -1 | 4294967295;
const keys: NumericKey[] = [2, 10, -1, 4294967295], names = ["2", "10", "-1", "4294967295"];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function cross(view: { [key: number]: RecordValue }, first: RecordValue, second: RecordValue): void {
  for (const written of [false, true]) {
    if (written) view[-1] = first;
    const expected: RecordValue[] = [second, first, written ? first : second, first];
    const constants: unknown[] = [view[2], view[10], view[-1], view[4294967295]];
    const strings: unknown[] = [view["2"], view["10"], view["-1"], view["4294967295"]];
    const values: unknown[] = Object.values(view), entries: [string, unknown][] = Object.entries(view);
    assert.compareArray(Object.keys(view), names);
    assert.sameValue(values.length, keys.length); assert.sameValue(entries.length, keys.length);
    for (let i = 0; i < keys.length; i++) {
      assert.sameValue(entries[i].length, 2);
      const key = keys[i]; assert.sameValue(key in view, true); same(entries[i][0], names[i]);
      same(view[key], expected[i]); same(constants[i], expected[i]); same(strings[i], expected[i]);
      same(values[i], expected[i]); same(entries[i][1], expected[i]);
    }
    assert.sameValue("missing" in view, false);
  }
}
const rows: [RecordValue, RecordValue][] = [[-0, NaN], [1.25, 2147483648], [9007199254740994, -2]];
for (const [first, second] of rows) {
  const source: { [key: number]: RecordValue } = { "10": first, "2": second, "-1": second, "4294967295": first };
  cross(source, first, second);
  const expected: RecordValue[] = [second, first, first, first];
  const constants: unknown[] = [source[2], source[10], source[-1], source[4294967295]];
  const strings: unknown[] = [source["2"], source["10"], source["-1"], source["4294967295"]];
  const values: unknown[] = Object.values(source), entries: [string, unknown][] = Object.entries(source);
  assert.compareArray(Object.keys(source), names);
  assert.sameValue(values.length, keys.length); assert.sameValue(entries.length, keys.length);
  for (let i = 0; i < keys.length; i++) {
    assert.sameValue(entries[i].length, 2);
    const key = keys[i]; assert.sameValue(key in source, true); same(entries[i][0], names[i]);
    same(source[key], expected[i]); same(constants[i], expected[i]); same(strings[i], expected[i]);
    same(values[i], expected[i]); same(entries[i][1], expected[i]);
  }
  assert.sameValue("missing" in source, false);
}
