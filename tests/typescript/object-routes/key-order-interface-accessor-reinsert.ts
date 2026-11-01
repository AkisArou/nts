/*---
description: "Deleting and recreating an optional accessor moves ordinary keys but restores integer-key position as data."
features: [ts-object-routes, ts-object-route-key-order, ts-objects, ts-functions, ts-iteration, ts-arrays, ts-unknown, ts-typeof-operator, ts-interfaces, ts-optional-properties, ts-accessors, ts-keyof, ts-type-aliases]
---*/
// An optional interface slot is read, deleted and recreated; node calls its getter once and thereafter keeps a plain data value.
interface ReinsertView { alpha?: unknown; "2"?: unknown; omega?: unknown; }
type ReinsertKey = keyof ReinsertView;
type ReinsertRow = { view: ReinsertView; key: "alpha" | "2"; next: unknown; initial: unknown; before: ReinsertKey[]; after: ReinsertKey[]; values: unknown[]; calls: string[] };
const events: string[] = [], reference = { id: 13 };
const rows: ReinsertRow[] = [
  { view: {}, key: "alpha", next: -0, initial: undefined, before: [], after: ["alpha"], values: [-0], calls: [] },
  { view: { alpha: undefined, omega: "" }, key: "alpha", next: NaN, initial: undefined, before: ["alpha", "omega"], after: ["omega", "alpha"], values: ["", NaN], calls: [] },
  { view: { get alpha() { events.push("get:alpha"); return NaN; }, omega: reference, "2": -0 }, key: "alpha", next: undefined, initial: NaN, before: ["2", "alpha", "omega"], after: ["2", "omega", "alpha"], values: [-0, reference, undefined], calls: ["get:alpha"] },
  { view: { alpha: "", get "2"() { events.push("get:2"); return reference; }, omega: undefined }, key: "2", next: null, initial: reference, before: ["2", "alpha", "omega"], after: ["2", "alpha", "omega"], values: [null, "", undefined], calls: ["get:2"] }
];
for (const row of rows) {
  events.length = 0; let view: ReinsertView = row.view;
  const before = Object.keys(view); assert.compareArray(before, row.before); assert.compareArray(events, []);
  const initial = view[row.key]; assert.sameValue(Object.is(initial, row.initial), true); assert.sameValue(typeof initial, typeof row.initial);
  delete view[row.key]; view[row.key] = row.next;
  const after = Object.keys(view), traversed: string[] = []; for (const key in view) traversed.push(key);
  assert.compareArray(after, row.after); assert.compareArray(traversed, row.after);
  for (let i = 0; i < row.after.length; i++) { const value = view[row.after[i]]; assert.sameValue(Object.is(value, row.values[i]), true); assert.sameValue(typeof value, typeof row.values[i]); }
  assert.sameValue(Object.is(view[row.key], row.next), true); assert.compareArray(events, row.calls);
}
