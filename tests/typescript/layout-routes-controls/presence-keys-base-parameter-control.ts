/*---
description: "Control for presence-keys-base-parameter; replace each class layout by ordered plain fields with a separate kind."
features: [ts-layout-routes, ts-layout-route-presence, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-null-undefined, ts-unions, ts-narrowing, ts-json-stringify]
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
type PresenceBase = { value: number; text: string };
function inspect(value: PresenceBase, row: PresenceRow, kind: string, keys: string[], json: string): void {
  same(value.value, row.num); same(value.text, row.text);
  same("value" in value, true); same("text" in value, true); same("absent" in value, false);
  same("reference" in value, kind === "reference"); if ("reference" in value) same(value.reference, row.ref);
  same("missing" in value, kind === "flags"); if ("missing" in value) same(value.missing, undefined);
  same("flag" in value, kind === "flags"); if ("flag" in value) same(value.flag, false);
  assert.compareArray(Object.keys(value), keys); same(JSON.stringify(value), json);
  for (const key of keys) same(Object.hasOwn(value, key), true);
}
for (const row of rows) {
  const stem = '{"value":' + row.scalar + ',"text":' + row.quoted;
  const base = { value: row.num, text: row.text }, reference = { value: row.num, text: row.text, reference: row.ref }, flags = { value: row.num, text: row.text, missing: undefined, flag: false };
  const fixtures: { value: PresenceBase; kind: string; keys: string[]; json: string }[] = [
    { value: base, kind: "base", keys: ["value", "text"], json: stem + "}" },
    { value: reference, kind: "reference", keys: ["value", "text", "reference"], json: stem + ',"reference":' + row.objectText + "}" },
    { value: flags, kind: "flags", keys: ["value", "text", "missing", "flag"], json: stem + ',"flag":false}' }
  ];
  for (const item of fixtures) inspect(item.value, row, item.kind, item.keys, item.json);
}
