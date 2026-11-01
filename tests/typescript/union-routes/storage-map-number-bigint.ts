/*---
description: number | bigint retains its member and exact payload through a reused map.
features: [ts-union-routes, ts-union-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-bigint, ts-unions, ts-narrowing, ts-map-set, ts-null-undefined]
---*/
// number | bigint travels through map storage; typeof selects the read branch and Node preserves the payload, branch order and printed text.
type StorageValue = number | bigint;
type StorageRow = { kind: string; num: number; big: bigint; text: string };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
const branches: string[] = [], printed: string[] = [];
function observe(value: StorageValue, row: StorageRow): void {
  if (typeof value === "number") { branches.push("number"); same(value, row.num); const line = String(value); same(line, row.text); printed.push(line); console.log(line); }
  else if (typeof value === "bigint") { branches.push("bigint"); same(value, row.big); const line = String(value); same(line, row.text); printed.push(line); console.log(line); }
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
  const input: StorageValue = row.kind === "number" ? row.num : row.big;
  carrier.set("slot", input); same(carrier.has("slot"), true); same(carrier.size, 1);
  const actual = carrier.get("slot");
  if (actual === undefined) throw new Test262Error("stored key missing");
  observe(actual, row);
}
assert.compareArray(branches, ["number", "bigint", "number", "bigint", "number", "bigint"]);
assert.compareArray(printed, ["0", "0", "NaN", "-1", "2.5", "9007199254740993"]);
