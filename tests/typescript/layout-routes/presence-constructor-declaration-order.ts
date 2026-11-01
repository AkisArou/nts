/*---
description: "Constructor writes preserve declared-field order while a declare field is inserted at its first assignment."
features: [ts-layout-routes, ts-layout-route-presence, ts-functions, ts-arrays, ts-objects, ts-iteration, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-null-undefined, ts-unions, ts-narrowing, ts-json-stringify, ts-class, ts-class-fields, ts-inheritance, ts-declare-field]
---*/
// Three layouts cross a PresenceBase parameter; reversed constructor assignments do not reorder defined fields, and a declared field appears after initialized fields.
type PresencePoint = { id: number };
type PresenceRow = { num: number; text: string; ref: PresencePoint | null; scalar: string; quoted: string; objectText: string };
const rows: PresenceRow[] = [
  { num: -0, text: "", ref: { id: 7 }, scalar: "0", quoted: '\"\"', objectText: '{"id":7}' },
  { num: NaN, text: "next", ref: null, scalar: "null", quoted: '\"next\"', objectText: "null" },
  { num: 8.5, text: "x", ref: { id: 9 }, scalar: "8.5", quoted: '\"x\"', objectText: '{"id":9}' }
];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
class PresenceBase { first: number; second: string; constructor(row: PresenceRow) { this.second = row.text; this.first = row.num; } }
class PresenceInitial extends PresenceBase { third: string = "initial"; fourth: number; constructor(row: PresenceRow) { super(row); this.fourth = row.num; this.third = row.text; } }
class PresenceLate extends PresenceBase { declare later: PresencePoint | null; third: string = "initial"; constructor(row: PresenceRow) { super(row); this.later = row.ref; this.third = row.text; } }
function inspect(value: PresenceBase, row: PresenceRow, kind: string, keys: string[], json: string): void {
  same(value.first, row.num); same(value.second, row.text);
  same("first" in value, true); same("second" in value, true); same("absent" in value, false);
  same("third" in value, kind !== "base"); if ("third" in value) same(value.third, row.text);
  same("fourth" in value, kind === "initial"); if ("fourth" in value) same(value.fourth, row.num);
  same("later" in value, kind === "late"); if ("later" in value) same(value.later, row.ref);
  assert.compareArray(Object.keys(value), keys); same(JSON.stringify(value), json);
  const visited: string[] = []; for (const key in value) visited.push(key); assert.compareArray(visited, keys);
}
for (const row of rows) {
  const stem = '{"first":' + row.scalar + ',"second":' + row.quoted;
  const base = new PresenceBase(row), initial = new PresenceInitial(row), late = new PresenceLate(row);
  const fixtures: { value: PresenceBase; kind: string; keys: string[]; json: string }[] = [
    { value: base, kind: "base", keys: ["first", "second"], json: stem + "}" },
    { value: initial, kind: "initial", keys: ["first", "second", "third", "fourth"], json: stem + ',"third":' + row.quoted + ',"fourth":' + row.scalar + "}" },
    { value: late, kind: "late", keys: ["first", "second", "third", "later"], json: stem + ',"third":' + row.quoted + ',"later":' + row.objectText + "}" }
  ];
  for (const item of fixtures) inspect(item.value, row, item.kind, item.keys, item.json);
}
