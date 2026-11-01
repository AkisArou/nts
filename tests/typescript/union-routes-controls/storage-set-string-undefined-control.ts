/*---
description: Control for storage-set-string-undefined; store separate payload fields and branch on kind.
features: [ts-union-routes, ts-union-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-strings, ts-null-undefined, ts-map-set]
---*/
// Use one record with kind, str and undef fields through the same set; branch on kind with the same payload, log and text assertions. Normalize numeric zero explicitly before storage.
type StorageValue = { kind: string; str: string; undef: undefined; };
type StorageRow = { kind: string; str: string; undef: undefined; text: string };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const branches: string[] = [], printed: string[] = [];
function observe(value: StorageValue, row: StorageRow): void {
  if (value.kind === "string") { branches.push("string"); same(value.str, row.str); const line = String(value.str); same(line, row.text); printed.push(line); console.log(line); }
  else if (value.kind === "undefined") { branches.push("undefined"); same(value.undef, row.undef); const line = String(value.undef); same(line, row.text); printed.push(line); console.log(line); }
  else throw new Test262Error("unrecognized stored member");
}
const rows: StorageRow[] = [
  { kind: "undefined", str: "unused", undef: undefined, text: "undefined" },
  { kind: "string", str: "", undef: undefined, text: "" },
  { kind: "undefined", str: "unused", undef: undefined, text: "undefined" },
  { kind: "string", str: "undefined", undef: undefined, text: "undefined" },
  { kind: "undefined", str: "unused", undef: undefined, text: "undefined" },
  { kind: "string", str: "tail", undef: undefined, text: "tail" },
];
const carrier = new Set<StorageValue>();
for (const row of rows) {
  const input: StorageValue = { kind: row.kind, str: row.str, undef: row.undef };
  carrier.clear(); carrier.add(input); carrier.add(input); same(carrier.size, 1); same(carrier.has(input), true);
  for (const actual of carrier) observe(actual, row);
}
assert.compareArray(branches, ["undefined", "string", "undefined", "string", "undefined", "string"]);
assert.compareArray(printed, ["undefined", "", "undefined", "undefined", "undefined", "tail"]);
