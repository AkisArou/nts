/*---
description: number | null retains its member and exact payload through a reused field.
features: [ts-union-routes, ts-union-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-null-undefined, ts-unions, ts-narrowing, ts-class, ts-class-fields]
---*/
// number | null travels through field storage; typeof selects the read branch and Node preserves the payload, branch order and printed text.
type StorageValue = number | null;
type StorageRow = { kind: string; num: number; nil: null; text: string };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const branches: string[] = [], printed: string[] = [];
function observe(value: StorageValue, row: StorageRow): void {
  if (typeof value === "number") { branches.push("number"); same(value, row.num); const line = String(value); same(line, row.text); printed.push(line); console.log(line); }
  else if (value === null) { branches.push("null"); same(value, row.nil); const line = String(value); same(line, row.text); printed.push(line); console.log(line); }
  else throw new Test262Error("unrecognized stored member");
}
const rows: StorageRow[] = [
  { kind: "number", num: -0, nil: null, text: "0" },
  { kind: "null", num: 91, nil: null, text: "null" },
  { kind: "number", num: NaN, nil: null, text: "NaN" },
  { kind: "null", num: 92, nil: null, text: "null" },
  { kind: "number", num: 2.5, nil: null, text: "2.5" },
  { kind: "null", num: 93, nil: null, text: "null" },
];
class StorageBox { value: StorageValue; constructor(value: StorageValue) { this.value = value; } }
const carrier = new StorageBox(5);
for (const row of rows) {
  const input: StorageValue = row.kind === "number" ? row.num : row.nil;
  carrier.value = input; observe(carrier.value, row);
}
assert.compareArray(branches, ["number", "null", "number", "null", "number", "null"]);
assert.compareArray(printed, ["0", "null", "NaN", "null", "2.5", "null"]);
