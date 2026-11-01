/*---
description: "Control for presence-definite-never-assigned; replace each class layout by ordered plain fields with a separate kind."
features: [ts-layout-routes, ts-layout-route-presence, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-null-undefined, ts-unions, ts-narrowing, ts-json-stringify, ts-optional-properties, ts-structural-typing, ts-spread]
---*/
// Plain data literals replace the three class layouts; kind remains beside the data so enumeration and JSON inspect the same fields.
type PresencePoint = { id: number };
type PresenceRow = { num: number; text: string; ref: PresencePoint | null; scalar: string; quoted: string; objectText: string };
const rows: PresenceRow[] = [
  { num: -0, text: "", ref: { id: 7 }, scalar: "0", quoted: '\"\"', objectText: '{"id":7}' },
  { num: NaN, text: "next", ref: null, scalar: "null", quoted: '\"next\"', objectText: "null" },
  { num: 8.5, text: "x", ref: { id: 9 }, scalar: "8.5", quoted: '\"x\"', objectText: '{"id":9}' }
];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
type PresenceBase = { slot: undefined; value: number };
type PresenceView = { slot: number | undefined; value: number; text?: string; pending?: string; reference?: PresencePoint | null; future?: PresencePoint };
function inspect(value: PresenceView, row: PresenceRow, kind: string, keys: string[], json: string): void {
  same(value.slot, undefined); same(value.value, row.num); same(value.pending, undefined); same(value.future, undefined);
  same(value.text, kind === "text" ? row.text : undefined); same(value.reference, kind === "reference" ? row.ref : undefined);
  same("slot" in value, true); same("value" in value, true); same("absent" in value, false);
  for (const key of ["text", "pending"]) same(key in value, kind === "text"); for (const key of ["reference", "future"]) same(key in value, kind === "reference");
  assert.compareArray(Object.keys(value), keys); same(JSON.stringify(value), json);
  const copy = { ...value }; assert.compareArray(Object.keys(copy), keys); same(JSON.stringify(copy), json); same(Object.hasOwn(copy, "slot"), true);
  same(copy.slot, undefined); same(copy.value, row.num); same(copy.pending, undefined); same(copy.future, undefined); same(copy.text, value.text); same(copy.reference, value.reference);
}
for (const row of rows) {
  const stem = '{"value":' + row.scalar;
  const base = { slot: undefined, value: row.num }, text = { slot: undefined, value: row.num, text: row.text, pending: undefined }, reference = { slot: undefined, value: row.num, reference: row.ref, future: undefined };
  const fixtures: { value: PresenceView; kind: string; keys: string[]; json: string }[] = [
    { value: base, kind: "base", keys: ["slot", "value"], json: stem + "}" },
    { value: text, kind: "text", keys: ["slot", "value", "text", "pending"], json: stem + ',"text":' + row.quoted + "}" },
    { value: reference, kind: "reference", keys: ["slot", "value", "reference", "future"], json: stem + ',"reference":' + row.objectText + "}" }
  ];
  for (const item of fixtures) inspect(item.value, row, item.kind, item.keys, item.json);
}
