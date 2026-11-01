/*---
description: Control for mapped-generic-keyof-record; begin with the type used for reads.
features: [ts-record-routes, ts-record-mapped, ts-functions, ts-iteration, ts-objects, ts-record, ts-index-signatures, ts-arrays, ts-tuples, ts-unions, ts-typeof-operator, ts-mapped-types, ts-utility-types, ts-type-operators, ts-numbers, ts-strings, ts-null-undefined, ts-generics, ts-generic-constraints, ts-keyof, ts-indexed-access, ts-narrowing]
---*/
// Only the source is declared Record<string, RecordValue> from creation; generic arguments, callback-free helper, writes and assertions are identical.
type RecordValue = number | string | boolean | undefined | null | { id: number } | number[];
type RouteKey = "2" | "10" | "01" | "-1" | "4294967295" | "label";
const keys: RouteKey[] = ["2", "10", "01", "-1", "4294967295", "label"];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function cross<T extends object>(view: T, keys: (keyof T)[], first: T[keyof T], second: T[keyof T]): void {
  for (const written of [false, true]) {
    if (written) view[keys[5]] = first;
    const observed = view;
    if (!("2" in observed) || !("10" in observed) || !("01" in observed) || !("-1" in observed) ||
        !("4294967295" in observed) || !("label" in observed)) throw new Error("fields");
    const expected: T[keyof T][] = [second, first, first, second, first, written ? first : second];
    const constants: unknown[] = [observed["2"], observed["10"], observed["01"], observed["-1"], observed["4294967295"], observed["label"]];
    const values: unknown[] = Object.values(view), entries: [string, unknown][] = Object.entries(view);
    assert.compareArray(Object.keys(view), keys.map(key => String(key)));
    assert.sameValue(values.length, keys.length); assert.sameValue(entries.length, keys.length);
    for (let i = 0; i < keys.length; i++) {
      assert.sameValue(entries[i].length, 2);
      const key = keys[i]; assert.sameValue(key in view, true); same(entries[i][0], key);
      same(view[key], expected[i]); same(constants[i], expected[i]);
      same(values[i], expected[i]); same(entries[i][1], expected[i]);
    }
    same(observed.label, expected[5]); assert.sameValue("missing" in view, false);
  }
}
const rows: [RecordValue, RecordValue][] = [[-0, NaN], ["text", false], [undefined, null], [{ id: 7 }, [8, 9]]];
for (const [first, second] of rows) {
  const source: Record<string, RecordValue> = { "10": first, "2": second, "01": first, "-1": second, "4294967295": first, label: second };
  cross<Record<string, RecordValue>>(source, keys, first, second);
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
