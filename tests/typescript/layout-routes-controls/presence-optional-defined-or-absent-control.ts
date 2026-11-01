/*---
description: "Control for presence-optional-defined-or-absent; replace each class layout by ordered plain fields with a separate kind."
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
type PresenceBase = { value: number };
type PresenceView = { value: number; optional?: string | null; marker?: boolean; reference?: PresencePoint | null };
function inspect(value: PresenceView, row: PresenceRow, kind: string, keys: string[], json: string): void {
  const expected = kind === "filled" ? (row.ref === null ? null : row.text) : undefined;
  same(value.value, row.num); same(value.optional, expected); same(value.marker, kind === "empty" ? false : undefined); same(value.reference, kind === "filled" ? row.ref : undefined);
  same("value" in value, true); same("optional" in value, kind !== "base"); same(Object.hasOwn(value, "optional"), kind !== "base");
  same("marker" in value, kind === "empty"); same("reference" in value, kind === "filled"); same("absent" in value, false);
  assert.compareArray(Object.keys(value), keys); same(JSON.stringify(value), json);
  const visited: string[] = []; for (const key in value) visited.push(key); assert.compareArray(visited, keys);
  const copy = { ...value }; assert.compareArray(Object.keys(copy), keys); same(JSON.stringify(copy), json);
  same(copy.value, row.num); same(copy.optional, expected); same(copy.marker, value.marker); same(copy.reference, value.reference); same("optional" in copy, kind !== "base");
}
for (const row of rows) {
  const stem = '{"value":' + row.scalar;
  const base = { value: row.num }, empty = { value: row.num, optional: undefined, marker: false }, filled = { value: row.num, optional: row.ref === null ? null : row.text, reference: row.ref };
  const fixtures: { value: PresenceView; kind: string; keys: string[]; json: string }[] = [
    { value: base, kind: "base", keys: ["value"], json: stem + "}" },
    { value: empty, kind: "empty", keys: ["value", "optional", "marker"], json: stem + ',"marker":false}' },
    { value: filled, kind: "filled", keys: ["value", "optional", "reference"], json: stem + ',"optional":' + (row.ref === null ? "null" : row.quoted) + ',"reference":' + row.objectText + "}" }
  ];
  for (const item of fixtures) inspect(item.value, row, item.kind, item.keys, item.json);
}
