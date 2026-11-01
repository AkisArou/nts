/*---
description: Control for mutations-add-numeric-and-named-keys; declare the original object as its final Record type from creation.
features: [ts-record-routes, ts-record-mutations, ts-record, ts-objects, ts-index-signatures, ts-type-aliases, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-strings, ts-null-undefined, ts-optional-properties, ts-typeof-operator, ts-unknown, ts-expressions, ts-keyof, ts-unions]
---*/
// Only the original declaration becomes Record<string, unknown>; values, mutation history and every assertion stay identical.
type Stored = number | string | boolean | undefined | null | { sample: unknown } | unknown[];
type RecordShape = { "2": unknown; "3"?: unknown; "10": unknown; "01": unknown; "-1": unknown; "4294967295": unknown; tail?: unknown; value: unknown; late?: unknown };
function observe(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const inputs: Stored[] = [-0, NaN, 1.25, "text", true, false, undefined, null, { sample: 7 }, [8, 9]];
for (let round = 0; round < inputs.length; round++) {
  const sample = inputs[round], next = inputs[(round + 1) % inputs.length]; const nested = { sample }, array = [sample];
  const old: Record<string, unknown> = { "10": sample, "2": -0, "01": NaN, "-1": false, "4294967295": undefined, tail: array, value: nested };
  const view: Record<string, unknown> = old;
  assert.sameValue(view, old);
  const orders: string[][] = [["2", "10", "01", "-1", "4294967295", "tail", "value"], ["2", "3", "10", "01", "-1", "4294967295", "tail", "value", "late"]];
  const contents: unknown[][] = [[-0, sample, NaN, false, undefined, array, nested], [-0, next, sample, NaN, false, undefined, array, nested, sample]];
  for (let phase = 0; phase < orders.length; phase++) {
    const keys = orders[phase], expected = contents[phase];
    const names: (keyof RecordShape)[] = ["2", "3", "10", "01", "-1", "4294967295", "tail", "value", "late"];
    const fixed: unknown[] = [view["2"], view["3"], view["10"], view["01"], view["-1"], view["4294967295"], view["tail"], view["value"], view["late"]];
    for (let i = 0; i < names.length; i++) {
      const key = names[i], index = keys.indexOf(key), wanted = index < 0 ? undefined : expected[index];
      for (const actual of [view[key], old[key], fixed[i]]) observe(actual, wanted);
      assert.sameValue(key in view, index >= 0); assert.sameValue(key in old, index >= 0);
    }
    const dotted: [string, unknown, unknown][] = [["tail", view.tail, old.tail], ["value", view.value, old.value], ["late", view.late, old.late]];
    for (const [key, current, original] of dotted) { const i = keys.indexOf(key); observe(current, i < 0 ? undefined : expected[i]); observe(original, i < 0 ? undefined : expected[i]); }
    assert.sameValue("missing" in view, false); assert.sameValue("missing" in old, false);
    assert.compareArray(Object.keys(view), keys); assert.compareArray(Object.keys(old), keys);
    const valueLists: unknown[][] = [Object.values(view), Object.values(old)];
    const entryLists: [string, unknown][][] = [Object.entries(view), Object.entries(old)];
    for (const values of valueLists) { assert.sameValue(values.length, expected.length); for (let i = 0; i < keys.length; i++) observe(values[i], expected[i]); }
    for (const entries of entryLists) { assert.sameValue(entries.length, keys.length); for (let i = 0; i < keys.length; i++) { assert.compareArray(entries[i], [keys[i], expected[i]]); observe(entries[i][0], keys[i]); observe(entries[i][1], expected[i]); } }
    if (phase === 0) { view["3"] = next; view.late = sample; }
  }
}
