/*---
description: number | string retains its member and exact payload through a reused set.
features: [ts-union-routes, ts-union-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-unions, ts-narrowing, ts-map-set]
---*/
// number | string travels through Set storage; typeof selects the read branch and Node deduplicates each repeated value, canonicalizing numeric zero to +0.
type StorageValue = number | string;
type StorageRow = { kind: string; num: number; str: string; text: string };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const branches: string[] = [], printed: string[] = [];
function observe(value: StorageValue, row: StorageRow): void {
  if (typeof value === "number") { branches.push("number"); same(value, row.num === 0 ? 0 : row.num); const line = String(value); same(line, row.text); printed.push(line); console.log(line); }
  else if (typeof value === "string") { branches.push("string"); same(value, row.str); const line = String(value); same(line, row.text); printed.push(line); console.log(line); }
  else throw new Test262Error("unrecognized stored member");
}
const rows: StorageRow[] = [
  { kind: "number", num: -0, str: "unused", text: "0" },
  { kind: "string", num: 91, str: "", text: "" },
  { kind: "number", num: NaN, str: "unused", text: "NaN" },
  { kind: "string", num: 92, str: "17", text: "17" },
  { kind: "number", num: 2.5, str: "unused", text: "2.5" },
  { kind: "string", num: 93, str: "tail", text: "tail" },
];
const carrier = new Set<StorageValue>();
for (const row of rows) {
  const input: StorageValue = row.kind === "number" ? row.num : row.str;
  carrier.clear(); carrier.add(input); carrier.add(input); same(carrier.size, 1); same(carrier.has(input), true);
  for (const actual of carrier) observe(actual, row);
}
assert.compareArray(branches, ["number", "string", "number", "string", "number", "string"]);
assert.compareArray(printed, ["0", "", "NaN", "17", "2.5", "tail"]);
