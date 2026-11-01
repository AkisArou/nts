/*---
description: "Explicit ordered-name control: String enumeration through a PropertyKey Record omits symbol keys without reading their getters."
features: [ts-object-routes, ts-object-route-key-order, ts-objects, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-typeof-operator, ts-record, ts-symbols, ts-computed-keys, ts-accessors, ts-tuples, ts-type-aliases]
---*/
// Mixed PropertyKey records cross a parameter; node entries ignores symbols, whose getters run only on later explicit symbol reads.
const first = Symbol("first"), second = Symbol("second"), reference = { id: 23 }, events: string[] = [];
type SymbolRow = { view: Record<PropertyKey, unknown>; names: string[]; values: unknown[]; symbols: symbol[]; symbolValues: unknown[]; calls: string[]; finalCalls: string[] };
function stringEntries(view: Record<PropertyKey, unknown>, names: string[]): [string, unknown][] { const entries: [string, unknown][] = []; for (const key of names) entries.push([key, view[key]]); return entries; }
const rows: SymbolRow[] = [
  { view: {}, names: [], values: [], symbols: [], symbolValues: [], calls: [], finalCalls: [] },
  { view: { optional: undefined, [first]: undefined }, names: ["optional"], values: [undefined], symbols: [first], symbolValues: [undefined], calls: [], finalCalls: [] },
  { view: { get [first]() { events.push("get:first"); return reference; }, tail: NaN, get "2"() { events.push("get:2"); return -0; }, [second]: undefined }, names: ["2", "tail"], values: [-0, NaN], symbols: [first, second], symbolValues: [reference, undefined], calls: ["get:2"], finalCalls: ["get:2", "get:first"] },
  { view: Object.freeze({ get [second]() { events.push("get:second"); return ""; }, "01": undefined, "1": null, alpha: reference }), names: ["1", "01", "alpha"], values: [null, undefined, reference], symbols: [second], symbolValues: [""], calls: [], finalCalls: ["get:second"] }
];
for (const row of rows) {
  events.length = 0; const keys = row.names.slice(), traversed: string[] = []; for (const key of row.names) traversed.push(key);
  assert.compareArray(keys, row.names); assert.compareArray(traversed, row.names); assert.compareArray(events, []);
  const entries = stringEntries(row.view, row.names); assert.sameValue(entries.length, row.names.length);
  for (let i = 0; i < entries.length; i++) { assert.sameValue(Object.is(entries[i][0], row.names[i]), true); assert.sameValue(Object.is(entries[i][1], row.values[i]), true); assert.sameValue(typeof entries[i][1], typeof row.values[i]); }
  assert.compareArray(events, row.calls);
  for (const symbol of [first, second]) assert.sameValue(Object.hasOwn(row.view, symbol), row.symbols.includes(symbol));
  for (let i = 0; i < row.symbols.length; i++) { const value = row.view[row.symbols[i]]; assert.sameValue(Object.is(value, row.symbolValues[i]), true); assert.sameValue(typeof value, typeof row.symbolValues[i]); }
  assert.compareArray(events, row.finalCalls);
}
