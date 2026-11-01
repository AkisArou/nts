/*---
description: string | undefined retains its member and exact payload through a reused closure.
features: [ts-union-routes, ts-union-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-strings, ts-null-undefined, ts-unions, ts-narrowing, ts-closures, ts-function-types, ts-arrow-functions]
---*/
// string | undefined travels through closure storage; typeof selects the read branch and Node preserves the payload, branch order and printed text.
type StorageValue = string | undefined;
type StorageRow = { kind: string; str: string; undef: undefined; text: string };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const branches: string[] = [], printed: string[] = [];
function observe(value: StorageValue, row: StorageRow): void {
  if (typeof value === "string") { branches.push("string"); same(value, row.str); const line = String(value); same(line, row.text); printed.push(line); console.log(line); }
  else if (typeof value === "undefined") { branches.push("undefined"); same(value, row.undef); const line = String(value); same(line, row.text); printed.push(line); console.log(line); }
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
function slot(initial: StorageValue): { write: (value: StorageValue) => void; read: () => StorageValue } {
  let held = initial; return { write: value => { held = value; }, read: () => held };
}
const carrier = slot("seed");
for (const row of rows) {
  const input: StorageValue = row.kind === "string" ? row.str : row.undef;
  carrier.write(input); observe(carrier.read(), row);
}
assert.compareArray(branches, ["undefined", "string", "undefined", "string", "undefined", "string"]);
assert.compareArray(printed, ["undefined", "", "undefined", "undefined", "undefined", "tail"]);
