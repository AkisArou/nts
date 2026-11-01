/*---
description: Control for objects-optional-member-field; select concrete payload fields by kind.
features: [ts-union-routes, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-objects, ts-union-route-objects, ts-interfaces, ts-object-type, ts-numbers, ts-strings, ts-null-undefined]
---*/
// Keep concrete object identities in separate fields and spell optional note storage as present/defined flags plus separate string and undefined fields.
interface PlainObject { kind: "plain"; value: number; }
interface ObjectRow { kind: string; noted: object; plain: PlainObject; present: boolean; defined: boolean; str: string; absent: undefined; }
const absent = { kind: "note" }, empty = { kind: "note", note: "" };
const undef = { kind: "note", note: undefined }, text = { kind: "note", note: "tail" };
const plain: PlainObject = { kind: "plain", value: -0 };
const rows: ObjectRow[] = [
  { kind: "note", noted: absent, plain, present: false, defined: false, str: "stale", absent: undefined },
  { kind: "note", noted: undef, plain, present: true, defined: false, str: "stale", absent: undefined },
  { kind: "note", noted: empty, plain, present: true, defined: true, str: "", absent: undefined },
  { kind: "note", noted: text, plain, present: true, defined: true, str: "tail", absent: undefined },
  { kind: "plain", noted: absent, plain, present: false, defined: false, str: "stale", absent: undefined }
];
const log: string[] = [];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function inspect(value: ObjectRow, expected: ObjectRow): void {
  if (value.kind === "note") {
    same(value.noted, expected.noted); log.push("note");
    const present = value.present; log.push(present ? "present" : "absent"); same(present, expected.present);
    if (value.defined) same(value.str, expected.str); else same(value.absent, undefined);
    same(value.present, expected.present);
  } else { log.push("plain"); same(value.plain, expected.plain); same(value.plain.value, -0); same(value.present, false); }
}
for (const row of rows) inspect({ kind: row.kind, noted: row.noted, plain: row.plain, present: row.present, defined: row.defined, str: row.str, absent: row.absent }, row);
assert.compareArray(log, ["note", "absent", "note", "present", "note", "present", "note", "present", "plain"]);
