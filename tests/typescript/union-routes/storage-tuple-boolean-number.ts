/*---
description: boolean | number retains its member and exact payload through a reused tuple.
features: [ts-union-routes, ts-union-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-unions, ts-narrowing, ts-tuples]
---*/
// boolean | number travels through tuple storage; typeof selects the read branch and Node preserves the payload, branch order and printed text.
type StorageValue = boolean | number;
type StorageRow = { kind: string; bool: boolean; num: number; text: string };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const branches: string[] = [], printed: string[] = [];
function observe(value: StorageValue, row: StorageRow): void {
  if (typeof value === "boolean") { branches.push("boolean"); same(value, row.bool); const line = String(value); same(line, row.text); printed.push(line); console.log(line); }
  else if (typeof value === "number") { branches.push("number"); same(value, row.num); const line = String(value); same(line, row.text); printed.push(line); console.log(line); }
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
const carrier: [number, StorageValue] = [7, true];
for (const row of rows) {
  const input: StorageValue = row.kind === "boolean" ? row.bool : row.num;
  carrier[1] = input; observe(carrier[1], row); same(carrier[0], 7); same(carrier.length, 2);
}
assert.compareArray(branches, ["boolean", "number", "boolean", "number", "boolean", "number"]);
assert.compareArray(printed, ["false", "0", "true", "NaN", "false", "2.5"]);
