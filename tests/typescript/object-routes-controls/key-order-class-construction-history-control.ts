/*---
description: "Explicit ordered-name control: Class entries keep each constructor history after sorting integer keys and omit inherited getters."
features: [ts-object-routes, ts-object-route-key-order, ts-objects, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-typeof-operator, ts-class, ts-class-fields, ts-declare-field, ts-index-signatures, ts-optional-properties, ts-accessors, ts-tuples]
---*/
// Declared optional fields add no storage; class-typed enumeration follows actual writes and never reads the inherited getter.
const events: string[] = [], reference = { id: 9 };
class OrderedShape {
  [key: string]: unknown;
  declare alpha?: unknown; declare beta?: unknown; declare "2"?: unknown; declare "10"?: unknown;
  get inherited(): unknown { events.push("get:inherited"); return reference; }
  constructor(mode: number) {
    if (mode === 1) this.beta = undefined;
    if (mode === 2) { this.beta = reference; this["10"] = -0; this.alpha = ""; this["2"] = NaN; }
    if (mode === 3) { this.alpha = undefined; this["2"] = reference; this.beta = null; this["10"] = 42; }
  }
}
type ShapeRow = { mode: number; names: string[]; values: unknown[] };
function inspectShape(view: OrderedShape, row: ShapeRow): void {
  const keys = row.names.slice(), entries: [string, unknown][] = [], traversed: string[] = [];
  for (const key of row.names) entries.push([key, view[key]]);
  for (const key of row.names) traversed.push(key);
  assert.compareArray(keys, row.names); assert.compareArray(traversed, row.names); assert.sameValue(entries.length, row.values.length);
  for (let i = 0; i < entries.length; i++) {
    assert.sameValue(Object.is(entries[i][0], row.names[i]), true);
    for (const value of [entries[i][1], view[row.names[i]]]) { assert.sameValue(Object.is(value, row.values[i]), true); assert.sameValue(typeof value, typeof row.values[i]); }
  }
  assert.compareArray(events, []);
}
const rows: ShapeRow[] = [
  { mode: 0, names: [], values: [] }, { mode: 1, names: ["beta"], values: [undefined] },
  { mode: 2, names: ["2", "10", "beta", "alpha"], values: [NaN, -0, reference, ""] },
  { mode: 3, names: ["2", "10", "alpha", "beta"], values: [reference, 42, undefined, null] }
];
for (const row of rows) { events.length = 0; const view = new OrderedShape(row.mode); if (row.mode === 3) Object.freeze(view); inspectShape(view, row); }
