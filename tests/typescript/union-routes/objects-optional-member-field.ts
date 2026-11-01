/*---
description: An optional field available in only one object-union member preserves absence and stored undefined.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-objects, ts-interfaces, ts-unions, ts-discriminated-unions, ts-narrowing, ts-optional-properties, ts-numbers, ts-strings, ts-null-undefined]
---*/
// NotedObject|PlainObject is narrowed by kind, then its member-only optional note is read; node distinguishes absent, own undefined, empty text and a value.
interface NotedObject { kind: "note"; note?: string; }
interface PlainObject { kind: "plain"; value: number; }
interface ObjectRow { kind: string; noted: NotedObject; plain: PlainObject; present: boolean; defined: boolean; str: string; }
const absent: NotedObject = { kind: "note" }, empty: NotedObject = { kind: "note", note: "" };
const undef: NotedObject = { kind: "note", note: undefined }, text: NotedObject = { kind: "note", note: "tail" };
const plain: PlainObject = { kind: "plain", value: -0 };
const rows: ObjectRow[] = [
  { kind: "note", noted: absent, plain, present: false, defined: false, str: "stale" },
  { kind: "note", noted: undef, plain, present: true, defined: false, str: "stale" },
  { kind: "note", noted: empty, plain, present: true, defined: true, str: "" },
  { kind: "note", noted: text, plain, present: true, defined: true, str: "tail" },
  { kind: "plain", noted: absent, plain, present: false, defined: false, str: "stale" }
];
const log: string[] = [];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function inspect(value: NotedObject | PlainObject, expected: ObjectRow): void {
  if (value.kind === "note") {
    same(value, expected.noted); log.push("note");
    const present = "note" in value; log.push(present ? "present" : "absent"); same(present, expected.present);
    same(value.note, expected.defined ? expected.str : undefined); same(Object.hasOwn(value, "note"), expected.present);
  } else { log.push("plain"); same(value, expected.plain); same(value.value, -0); same("note" in value, false); }
}
for (const row of rows) inspect(row.kind === "note" ? row.noted : row.plain, row);
assert.compareArray(log, ["note", "absent", "note", "present", "note", "present", "note", "present", "plain"]);
