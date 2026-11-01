/*---
description: Control for storage-map-number-bigint; store separate payload fields and branch on kind.
features: [ts-union-routes, ts-union-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-bigint, ts-map-set, ts-null-undefined]
---*/
// Use one record with kind, num and big fields through the same map; branch on kind with the same payload, log and text assertions.
type StorageValue = { kind: string; num: number; big: bigint; };
type StorageRow = { kind: string; num: number; big: bigint; text: string };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const branches: string[] = [], printed: string[] = [];
function observe(value: StorageValue, row: StorageRow): void {
  if (value.kind === "number") { branches.push("number"); same(value.num, row.num); const line = String(value.num); same(line, row.text); printed.push(line); console.log(line); }
  else if (value.kind === "bigint") { branches.push("bigint"); same(value.big, row.big); const line = String(value.big); same(line, row.text); printed.push(line); console.log(line); }
  else throw new Test262Error("unrecognized stored member");
}
const rows: StorageRow[] = [
  { kind: "number", num: -0, big: 7n, text: "0" },
  { kind: "bigint", num: 91, big: 0n, text: "0" },
  { kind: "number", num: NaN, big: 7n, text: "NaN" },
  { kind: "bigint", num: 92, big: -1n, text: "-1" },
  { kind: "number", num: 2.5, big: 7n, text: "2.5" },
  { kind: "bigint", num: 93, big: 9007199254740993n, text: "9007199254740993" },
];
const carrier = new Map<string, StorageValue>();
for (const row of rows) {
  const input: StorageValue = { kind: row.kind, num: row.num, big: row.big };
  carrier.set("slot", input); same(carrier.has("slot"), true); same(carrier.size, 1);
  const actual = carrier.get("slot");
  if (actual === undefined) throw new Test262Error("stored key missing");
  observe(actual, row);
}
assert.compareArray(branches, ["number", "bigint", "number", "bigint", "number", "bigint"]);
assert.compareArray(printed, ["0", "0", "NaN", "-1", "2.5", "9007199254740993"]);
