/*---
description: "Typed fromEntries keeps distinct same-description symbols and updates a repeated symbol without exposing symbols as string keys."
features: [ts-object-routes, ts-object-route-statics, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-iteration, ts-record, ts-tuples, ts-symbols]
---*/
// PropertyKey tuple entries cross a Record result; node preserves symbol identity and insertion order alongside exact enumerable string order and last writes.
type StaticValue = number | string | boolean | null | undefined | { id: number };
const marker = { id: 7 }, replacement = { id: 7 };
const inputs: StaticValue[] = [-0, NaN, "", "text", undefined, null, false, marker, replacement];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type SymbolRow = { entries: [PropertyKey, StaticValue][]; keys: string[]; values: StaticValue[]; symbols: symbol[]; symbolValues: StaticValue[] };
function inspect(input: StaticValue): void {
  const left = Symbol("same"), right = Symbol("same");
  const rows: SymbolRow[] = [
    { entries: [], keys: [], values: [], symbols: [], symbolValues: [] },
    { entries: [[left, input], ["tail", marker], [right, NaN], [left, replacement], ["maybe", undefined]], keys: ["tail", "maybe"], values: [marker, undefined], symbols: [left, right], symbolValues: [replacement, NaN] },
    { entries: [[right, input], ["2", undefined], [left, marker], ["same", input]], keys: ["2", "same"], values: [undefined, input], symbols: [right, left], symbolValues: [input, marker] }
  ];
  for (const row of rows) {
    const actual: Record<PropertyKey, StaticValue> = Object.fromEntries<StaticValue>(row.entries), walked: string[] = [];
    for (const key in actual) walked.push(key);
    assert.compareArray(Object.keys(actual), row.keys); assert.compareArray(walked, row.keys); assert.compareArray(Object.getOwnPropertySymbols(actual), row.symbols);
    for (let i = 0; i < row.keys.length; i++) same(actual[row.keys[i]], row.values[i]);
    for (let i = 0; i < row.symbols.length; i++) { same(Object.hasOwn(actual, row.symbols[i]), true); same(actual[row.symbols[i]], row.symbolValues[i]); }
  }
}
for (const input of inputs) inspect(input);
