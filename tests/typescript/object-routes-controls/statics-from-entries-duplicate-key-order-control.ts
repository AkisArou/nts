/*---
description: "Control for statics-from-entries-duplicate-key-order; Typed fromEntries preserves first key positions while later numeric and string duplicates replace their values."
features: [ts-object-routes, ts-object-route-statics, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-iteration, ts-record, ts-tuples, ts-conversions]
---*/
// Tuple entries carry string or number keys and union values; node canonicalizes -0 and NaN, sorts index keys and retains the last value without moving an existing string key. The control writes the operation explicitly.
type StaticValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: StaticValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type EntryRow = { entries: [string | number, StaticValue][]; keys: string[]; values: StaticValue[] };
function inspect(input: StaticValue): void {
  const rows: EntryRow[] = [
    { entries: [], keys: [], values: [] },
    { entries: [[10, input], ["tail", marker], [2, NaN], ["10", replacement], ["tail", undefined], ["01", input]], keys: ["2", "10", "tail", "01"], values: [NaN, replacement, undefined, input] },
    { entries: [[-0, input], ["-0", NaN], [0, replacement], ["NaN", undefined], [NaN, marker]], keys: ["0", "-0", "NaN"], values: [replacement, NaN, marker] },
    { entries: [["maybe", undefined]], keys: ["maybe"], values: [undefined] }
  ];
  for (const row of rows) {
    const actual: Record<string, StaticValue> = {}, walked: string[] = [];
    for (const entry of row.entries) actual[String(entry[0])] = entry[1];
    for (const key in actual) walked.push(key);
    assert.compareArray(Object.keys(actual), row.keys); assert.compareArray(walked, row.keys);
    for (let i = 0; i < row.keys.length; i++) { same(Object.hasOwn(actual, row.keys[i]), true); same(actual[row.keys[i]], row.values[i]); }
    same(Object.hasOwn(actual, "missing"), false);
  }
}
for (const input of inputs) inspect(input);
