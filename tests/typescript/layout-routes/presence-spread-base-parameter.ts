/*---
description: "Spreading a base-class parameter copies every subclass field in order and leaves the source independent."
features: [ts-layout-routes, ts-layout-route-presence, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-null-undefined, ts-unions, ts-narrowing, ts-json-stringify, ts-spread, ts-class, ts-class-fields, ts-inheritance]
---*/
// PresenceBase(value,text), PresenceReference(+reference) and PresenceFlags(+missing,flag) cross the named base route; node retains complete ordered own data.
type PresencePoint = { id: number };
type PresenceRow = { num: number; text: string; ref: PresencePoint | null; scalar: string; quoted: string; objectText: string };
const rows: PresenceRow[] = [
  { num: -0, text: "", ref: { id: 7 }, scalar: "0", quoted: '\"\"', objectText: '{"id":7}' },
  { num: NaN, text: "next", ref: null, scalar: "null", quoted: '\"next\"', objectText: "null" },
  { num: 8.5, text: "x", ref: { id: 9 }, scalar: "8.5", quoted: '\"x\"', objectText: '{"id":9}' }
];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
class PresenceBase { value: number; text: string; constructor(row: PresenceRow) { this.value = row.num; this.text = row.text; } }
class PresenceReference extends PresenceBase { reference: PresencePoint | null; constructor(row: PresenceRow) { super(row); this.reference = row.ref; } }
class PresenceFlags extends PresenceBase { missing: undefined; flag: boolean; constructor(row: PresenceRow) { super(row); this.missing = undefined; this.flag = false; } }
function inspect(value: PresenceBase, row: PresenceRow, kind: string, keys: string[], json: string): void {
  same(value.value, row.num); same(value.text, row.text);
  same("value" in value, true); same("text" in value, true); same("absent" in value, false);
  same("reference" in value, kind === "reference"); if ("reference" in value) same(value.reference, row.ref);
  same("missing" in value, kind === "flags"); if ("missing" in value) same(value.missing, undefined);
  same("flag" in value, kind === "flags"); if ("flag" in value) same(value.flag, false);
  assert.compareArray(Object.keys(value), keys); same(JSON.stringify(value), json);
  const copy = { ...value }; assert.compareArray(Object.keys(copy), keys); same(JSON.stringify(copy), json);
  same(copy.value, row.num); same(copy.text, row.text); same(Object.is(copy, value), false);
  if ("reference" in copy) same(copy.reference, row.ref); if ("missing" in copy) same(copy.missing, undefined); if ("flag" in copy) same(copy.flag, false);
  copy.value = 91; same(copy.value, 91); same(value.value, row.num);
}
for (const row of rows) {
  const stem = '{"value":' + row.scalar + ',"text":' + row.quoted;
  const base = new PresenceBase(row), reference = new PresenceReference(row), flags = new PresenceFlags(row);
  const fixtures: { value: PresenceBase; kind: string; keys: string[]; json: string }[] = [
    { value: base, kind: "base", keys: ["value", "text"], json: stem + "}" },
    { value: reference, kind: "reference", keys: ["value", "text", "reference"], json: stem + ',"reference":' + row.objectText + "}" },
    { value: flags, kind: "flags", keys: ["value", "text", "missing", "flag"], json: stem + ',"flag":false}' }
  ];
  for (const item of fixtures) inspect(item.value, row, item.kind, item.keys, item.json);
}
