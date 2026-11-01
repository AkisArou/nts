/*---
description: Control for storage-field-boolean-number; store separate payload fields and branch on kind.
features: [ts-union-routes, ts-union-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-class, ts-class-fields]
---*/
// Use one record with kind, bool and num fields through the same field; branch on kind with the same payload, log and text assertions.
type StorageValue = { kind: string; bool: boolean; num: number; };
type StorageRow = { kind: string; bool: boolean; num: number; text: string };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const branches: string[] = [], printed: string[] = [];
function observe(value: StorageValue, row: StorageRow): void {
  if (value.kind === "boolean") { branches.push("boolean"); same(value.bool, row.bool); const line = String(value.bool); same(line, row.text); printed.push(line); console.log(line); }
  else if (value.kind === "number") { branches.push("number"); same(value.num, row.num); const line = String(value.num); same(line, row.text); printed.push(line); console.log(line); }
  else throw new Test262Error("unrecognized stored member");
}
const rows: StorageRow[] = [
  { kind: "boolean", bool: false, num: 91, text: "false" },
  { kind: "number", bool: true, num: -0, text: "0" },
  { kind: "boolean", bool: true, num: 92, text: "true" },
  { kind: "number", bool: false, num: NaN, text: "NaN" },
  { kind: "boolean", bool: false, num: 93, text: "false" },
  { kind: "number", bool: true, num: 2.5, text: "2.5" },
];
class StorageBox { value: StorageValue; constructor(value: StorageValue) { this.value = value; } }
const carrier = new StorageBox({ kind: "boolean", bool: true, num: 5 });
for (const row of rows) {
  const input: StorageValue = { kind: row.kind, bool: row.bool, num: row.num };
  carrier.value = input; observe(carrier.value, row);
}
assert.compareArray(branches, ["boolean", "number", "boolean", "number", "boolean", "number"]);
assert.compareArray(printed, ["false", "0", "true", "NaN", "false", "2.5"]);
