/*---
description: "Definite-assignment fields keep own undefined slots through a structural view of three class layouts."
features: [ts-layout-routes, ts-layout-route-presence, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-null-undefined, ts-unions, ts-narrowing, ts-json-stringify, ts-optional-properties, ts-structural-typing, ts-spread, ts-class, ts-class-fields, ts-inheritance, ts-definite-assignment]
---*/
// PresenceBase.slot!, PresenceText.pending! and PresenceReference.future! are never assigned; node defines each field in its class order and a structural spread retains it.
type PresencePoint = { id: number };
type PresenceRow = { num: number; text: string; ref: PresencePoint | null; scalar: string; quoted: string; objectText: string };
const rows: PresenceRow[] = [
  { num: -0, text: "", ref: { id: 7 }, scalar: "0", quoted: '\"\"', objectText: '{"id":7}' },
  { num: NaN, text: "next", ref: null, scalar: "null", quoted: '\"next\"', objectText: "null" },
  { num: 8.5, text: "x", ref: { id: 9 }, scalar: "8.5", quoted: '\"x\"', objectText: '{"id":9}' }
];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
class PresenceBase { slot!: number; value: number; constructor(row: PresenceRow) { this.value = row.num; } }
class PresenceText extends PresenceBase { text: string; pending!: string; constructor(row: PresenceRow) { super(row); this.text = row.text; } }
class PresenceReference extends PresenceBase { reference: PresencePoint | null; future!: PresencePoint; constructor(row: PresenceRow) { super(row); this.reference = row.ref; } }
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
  const base = new PresenceBase(row), text = new PresenceText(row), reference = new PresenceReference(row);
  const fixtures: { value: PresenceView; kind: string; keys: string[]; json: string }[] = [
    { value: base, kind: "base", keys: ["slot", "value"], json: stem + "}" },
    { value: text, kind: "text", keys: ["slot", "value", "text", "pending"], json: stem + ',"text":' + row.quoted + "}" },
    { value: reference, kind: "reference", keys: ["slot", "value", "reference", "future"], json: stem + ',"reference":' + row.objectText + "}" }
  ];
  for (const item of fixtures) inspect(item.value, row, item.kind, item.keys, item.json);
}
