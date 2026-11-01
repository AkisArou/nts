/*---
description: Control for storage-array-number-null; store separate payload fields and branch on kind.
features: [ts-union-routes, ts-union-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-null-undefined]
---*/
// Use one record with kind, num and nil fields through the same array; branch on kind with the same payload, log and text assertions.
type StorageValue = { kind: string; num: number; nil: null; };
type StorageRow = { kind: string; num: number; nil: null; text: string };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const branches: string[] = [], printed: string[] = [];
function observe(value: StorageValue, row: StorageRow): void {
  if (value.kind === "number") { branches.push("number"); same(value.num, row.num); const line = String(value.num); same(line, row.text); printed.push(line); console.log(line); }
  else if (value.kind === "null") { branches.push("null"); same(value.nil, row.nil); const line = String(value.nil); same(line, row.text); printed.push(line); console.log(line); }
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
const carrier: StorageValue[] = [{ kind: "number", num: 5, nil: null }];
for (const row of rows) {
  const input: StorageValue = { kind: row.kind, num: row.num, nil: row.nil };
  carrier[0] = input; observe(carrier[0], row); same(carrier.length, 1);
}
assert.compareArray(branches, ["number", "null", "number", "null", "number", "null"]);
assert.compareArray(printed, ["0", "null", "NaN", "null", "2.5", "null"]);
