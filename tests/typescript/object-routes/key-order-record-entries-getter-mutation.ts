/*---
description: "Record entries skip a later deleted property and defer keys added by an earlier getter."
features: [ts-object-routes, ts-object-route-key-order, ts-objects, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-typeof-operator, ts-record, ts-index-signatures, ts-accessors, ts-closures, ts-tuples, ts-optional-properties]
---*/
// A getter-bearing Record crosses entriesOf; node snapshots keys, skips the deleted later key and exposes additions only afterwards.
const events: string[] = [], reference = { id: 17 };
function makeEntryRecord(mutate: boolean): Record<string, unknown> {
  const view: Record<string, unknown> = {
    tail: reference,
    get "2"() { events.push("get:2"); if (mutate) { delete view.later; view["1"] = -0; view.added = NaN; } return reference; },
    later: undefined, get "10"() { events.push("get:10"); return ""; }
  }; return view;
}
type EntryRow = { view: Record<string, unknown>; before: string[]; names: string[]; values: unknown[]; after: string[]; calls: string[]; mutated: boolean };
function entriesOf(view: Record<string, unknown>, names: string[]): [string, unknown][] { return Object.entries(view); }
const rows: EntryRow[] = [
  { view: {}, before: [], names: [], values: [], after: [], calls: [], mutated: false },
  { view: { tail: undefined }, before: ["tail"], names: ["tail"], values: [undefined], after: ["tail"], calls: [], mutated: false },
  { view: makeEntryRecord(true), before: ["2", "10", "tail", "later"], names: ["2", "10", "tail"], values: [reference, "", reference], after: ["1", "2", "10", "tail", "added"], calls: ["get:2", "get:10"], mutated: true },
  { view: Object.freeze(makeEntryRecord(false)), before: ["2", "10", "tail", "later"], names: ["2", "10", "tail", "later"], values: [reference, "", reference, undefined], after: ["2", "10", "tail", "later"], calls: ["get:2", "get:10"], mutated: false }
];
for (const row of rows) {
  events.length = 0; const before = Object.keys(row.view); assert.compareArray(before, row.before); assert.compareArray(events, []);
  const entries = entriesOf(row.view, row.names); assert.sameValue(entries.length, row.names.length);
  for (let i = 0; i < entries.length; i++) { assert.sameValue(Object.is(entries[i][0], row.names[i]), true); assert.sameValue(Object.is(entries[i][1], row.values[i]), true); assert.sameValue(typeof entries[i][1], typeof row.values[i]); }
  const after = Object.keys(row.view), traversed: string[] = []; for (const key in row.view) traversed.push(key);
  assert.compareArray(after, row.after); assert.compareArray(traversed, row.after);
  assert.sameValue(Object.is(row.view["1"], row.mutated ? -0 : undefined), true); assert.sameValue(Object.is(row.view.added, row.mutated ? NaN : undefined), true);
  assert.compareArray(events, row.calls);
}
