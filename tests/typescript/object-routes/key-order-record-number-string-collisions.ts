/*---
description: "Number and string writes share canonical keys while noncanonical numeric strings retain insertion order."
features: [ts-object-routes, ts-object-route-key-order, ts-objects, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-typeof-operator, ts-record, ts-index-signatures, ts-unions, ts-numbers, ts-strings, ts-tuples]
---*/
// A number|string write list builds a Record; node merges numeric -0 with "0", sorts array indices, and retains other spellings.
type WriteRow = { writes: [number | string, unknown][]; names: string[]; values: unknown[]; frozen: boolean };
const reference = { id: 11 };
function buildRecord(writes: [number | string, unknown][]): Record<string, unknown> {
  const view: Record<string, unknown> = {}; for (const [key, value] of writes) view[key] = value; return view;
}
const rows: WriteRow[] = [
  { writes: [], names: [], values: [], frozen: false },
  { writes: [["value", undefined]], names: ["value"], values: [undefined], frozen: true },
  { writes: [["b", -0], [2, NaN], ["02", ""], [-0, reference], ["-0", null], ["0", undefined], ["2", "last"], ["a", false]], names: ["0", "2", "b", "02", "-0", "a"], values: [undefined, "last", -0, "", null, false], frozen: false },
  { writes: [["4294967295", reference], ["1e0", NaN], [4294967294, -0], ["01", undefined], [1, null], [1.0, "same"], ["tail", ""]], names: ["1", "4294967294", "4294967295", "1e0", "01", "tail"], values: ["same", -0, reference, NaN, undefined, ""], frozen: true }
];
for (const row of rows) {
  const view: Record<string, unknown> = buildRecord(row.writes); if (row.frozen) Object.freeze(view);
  const keys = Object.keys(view), entries: [string, unknown][] = Object.entries(view), traversed: string[] = [];
  for (const key in view) traversed.push(key);
  assert.compareArray(keys, row.names); assert.compareArray(traversed, row.names); assert.sameValue(entries.length, row.values.length);
  for (let i = 0; i < entries.length; i++) {
    assert.sameValue(Object.is(entries[i][0], row.names[i]), true);
    for (const value of [entries[i][1], view[row.names[i]]]) { assert.sameValue(Object.is(value, row.values[i]), true); assert.sameValue(typeof value, typeof row.values[i]); }
  }
}
