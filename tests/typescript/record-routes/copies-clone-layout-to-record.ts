/*---
description: A structured clone of a laid-out object read as a Record preserves exact values and owns independent nested objects and arrays.
features: [ts-record-routes, ts-record-copies, ts-record, ts-objects, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-null-undefined, ts-arrays, ts-type-aliases, ts-tuples, ts-unions, ts-keyof]
---*/
// Clone a fixed-field object, then read it as a table; node preserves contents and key order while deeply separating child identities.
type CopyShape = {
  "2": number; "10": number; "01": string; "-1": boolean; "4294967295": undefined;
  empty: null; object: { n: number }; array: number[]; written: number | string;
};
function expectValue(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const n of [-2, 0, 17]) {
  const inner = { n }; const list = [n];
  const source: CopyShape = { "10": NaN, "01": "v" + n, "2": -0, "-1": n < 0, "4294967295": undefined,
    empty: null, object: inner, array: list, written: n };
  const built = structuredClone(source);
  const value: Record<string, unknown> = built;
  assert.sameValue(Object.is(value, built), true); assert.sameValue(Object.is(value, source), false);
  const object = value.object, array = value.array;
  if (typeof object !== "object" || object === null || !("n" in object) || !Array.isArray(array)) throw new Error("clone");
  const items: unknown[] = array;
  assert.sameValue(Object.is(object, inner), false); assert.sameValue(Object.is(array, list), false);
  inner.n = n + 1; list[0] = n + 1;
  const childKey: "n" = "n"; expectValue(object[childKey], n); expectValue(object.n, n); expectValue(object["n"], n);
  for (const index of [0]) { expectValue(items[index], n); expectValue(items[0], n); }
  assert.compareArray(Object.keys(object), ["n"]); assert.compareArray(Object.values<unknown>(object), [n]);
  const childEntries = Object.entries<unknown>(object), itemEntries = Object.entries<unknown>(items);
  assert.sameValue(childEntries.length, 1); assert.compareArray(childEntries[0], ["n", n]);
  assert.sameValue(itemEntries.length, 1); assert.compareArray(itemEntries[0], ["0", n]);
  assert.compareArray(Object.keys(items), ["0"]); assert.compareArray(Object.values<unknown>(items), [n]);
  assert.sameValue(items.length, 1); assert.sameValue("n" in object, true); assert.sameValue("missing" in object, false);
  assert.sameValue(0 in items, true); assert.sameValue("missing" in items, false);
  for (const phase of [0, 1]) {
    if (phase === 1) value.written = "after" + n;
    const keys: (keyof CopyShape)[] = ["2", "10", "01", "-1", "4294967295", "empty", "object", "array", "written"];
    const expected: unknown[] = [-0, NaN, "v" + n, n < 0, undefined, null, object, array, phase === 0 ? n : "after" + n];
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
    expectValue(source.written, n); expectValue(source["01"], "v" + n);
  }
}
