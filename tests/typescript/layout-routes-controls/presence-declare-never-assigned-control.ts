/*---
description: "Control for presence-declare-never-assigned; replace each class layout by ordered plain fields with a separate kind."
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
type PresenceBase = { value: number; absent?: string };
type PresenceView = { value: number; absent?: string; text?: string; extra?: PresencePoint; reference?: PresencePoint | null; removed?: number };
function inspect(value: PresenceView, row: PresenceRow, kind: string, keys: string[], json: string): void {
  same(value.value, row.num); same(value.absent, undefined); same(value.extra, undefined); same(value.removed, undefined);
  same(value.text, kind === "text" ? row.text : undefined); same(value.reference, kind === "reference" ? row.ref : undefined);
  same("value" in value, true); same("text" in value, kind === "text"); same("reference" in value, kind === "reference");
  for (const key of ["absent", "extra", "removed"]) { same(key in value, false); same(Object.hasOwn(value, key), false); }
  assert.compareArray(Object.keys(value), keys); same(JSON.stringify(value), json);
  const copy = { ...value }; assert.compareArray(Object.keys(copy), keys); same(JSON.stringify(copy), json);
  same(copy.value, row.num); same(copy.absent, undefined); same(copy.extra, undefined); same(copy.removed, undefined); same(copy.text, value.text); same(copy.reference, value.reference);
}
for (const row of rows) {
  const stem = '{"value":' + row.scalar;
  const base = { value: row.num }, text = { value: row.num, text: row.text }, reference = { value: row.num, reference: row.ref };
  const fixtures: { value: PresenceView; kind: string; keys: string[]; json: string }[] = [
    { value: base, kind: "base", keys: ["value"], json: stem + "}" },
    { value: text, kind: "text", keys: ["value", "text"], json: stem + ',"text":' + row.quoted + "}" },
    { value: reference, kind: "reference", keys: ["value", "reference"], json: stem + ',"reference":' + row.objectText + "}" }
  ];
  for (const item of fixtures) inspect(item.value, row, item.kind, item.keys, item.json);
}
