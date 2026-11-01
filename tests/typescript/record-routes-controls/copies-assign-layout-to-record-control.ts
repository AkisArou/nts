/*---
description: Control for copies-assign-layout-to-record; construct the copied value in its read type from the start.
features: [ts-record-routes, ts-record-copies, ts-record, ts-objects, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-null-undefined, ts-arrays, ts-type-aliases, ts-tuples, ts-unions, ts-keyof]
---*/
// Only the source or constructed table declarations change to the final read type; operations, values and assertions are identical.
type CopyShape = {
  "2": number; "10": number; "01": string; "-1": boolean; "4294967295": undefined;
  empty: null; object: { n: number }; array: number[]; written: number | string;
};
function expectValue(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-2, 0, 17]) {
  const inner = { n }; const list = [n];
  const source: Record<string, unknown> = { "10": NaN, "01": "v" + n, "2": -0, "-1": n < 0, "4294967295": undefined,
    empty: null, object: inner, array: list, written: n };
  const target: Record<string, unknown> = {};
  const built = Object.assign(target, source);
  const value: Record<string, unknown> = built;
  assert.sameValue(Object.is(value, built), true);
  assert.sameValue(Object.is(value, source), false);
  assert.sameValue(Object.is(value, target), true);
  for (const phase of [0, 1]) {
    if (phase === 1) value.written = "after" + n;
    const keys: (keyof CopyShape)[] = ["2", "10", "01", "-1", "4294967295", "empty", "object", "array", "written"];
    const expected: unknown[] = [-0, NaN, "v" + n, n < 0, undefined, null, inner, list, phase === 0 ? n : "after" + n];
    const constant: unknown[] = [value["2"], value["10"], value["01"], value["-1"], value["4294967295"],
      value["empty"], value["object"], value["array"], value["written"]];
    const values: unknown[] = Object.values<unknown>(value); const entries: [string, unknown][] = Object.entries<unknown>(value);
    assert.compareArray(Object.keys(value), keys); assert.compareArray(values, expected); assert.sameValue(entries.length, keys.length);
    for (let i = 0; i < keys.length; i++) {
      assert.sameValue(keys[i] in value, true); assert.compareArray(entries[i], [keys[i], expected[i]]);
      for (const read of [value[keys[i]], constant[i], values[i], entries[i][1]]) expectValue(read, expected[i]);
    }
    const dotted: unknown[] = [value.empty, value.object, value.array, value.written];
    for (let i = 0; i < dotted.length; i++) expectValue(dotted[i], expected[i + 5]);
    assert.sameValue("missing" in value, false); expectValue(built.written, expected[8]);
    expectValue(target.written, expected[8]);
    expectValue(source.written, n); expectValue(source["01"], "v" + n);
  }
}
