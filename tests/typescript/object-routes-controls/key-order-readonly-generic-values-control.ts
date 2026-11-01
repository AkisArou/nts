/*---
description: "Explicit ordered-name control: Object.values follows ordered own getter reads through a readonly generic constraint."
features: [ts-object-routes, ts-object-route-key-order, ts-objects, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-typeof-operator, ts-generics, ts-generic-constraints, ts-readonly, ts-record, ts-accessors, ts-type-aliases]
---*/
// Readonly generic records retain actual shape; node values reads numeric getters first, then string getters, exactly once.
const events: string[] = [], reference = { id: 19 };
type ValueRow = { view: Readonly<Record<string, unknown>>; names: string[]; values: unknown[]; calls: string[] };
function orderedValues<T extends Readonly<Record<string, unknown>>>(view: T, names: string[]): unknown[] { const values: unknown[] = []; for (const key of names) values.push(view[key]); return values; }
const rows: ValueRow[] = [
  { view: {}, names: [], values: [], calls: [] },
  { view: { optional: undefined }, names: ["optional"], values: [undefined], calls: [] },
  { view: { get tail() { events.push("get:tail"); return reference; }, get "10"() { events.push("get:10"); return NaN; }, get "2"() { events.push("get:2"); return -0; }, "02": "" }, names: ["2", "10", "tail", "02"], values: [-0, NaN, reference, ""], calls: ["get:2", "get:10", "get:tail"] },
  { view: Object.freeze({ get optional() { events.push("get:optional"); return undefined; }, "1": null, get end() { events.push("get:end"); return reference; } }), names: ["1", "optional", "end"], values: [null, undefined, reference], calls: ["get:optional", "get:end"] }
];
for (const row of rows) {
  events.length = 0; const keys = row.names.slice(), traversed: string[] = []; for (const key of row.names) traversed.push(key);
  assert.compareArray(keys, row.names); assert.compareArray(traversed, row.names); assert.compareArray(events, []);
  const values = orderedValues(row.view, row.names); assert.sameValue(values.length, row.values.length);
  for (let i = 0; i < values.length; i++) { assert.sameValue(Object.is(values[i], row.values[i]), true); assert.sameValue(typeof values[i], typeof row.values[i]); }
  assert.compareArray(events, row.calls);
}
