/*---
description: number | bigint retains its member and exact payload through a reused closure.
features: [ts-union-routes, ts-union-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-bigint, ts-unions, ts-narrowing, ts-closures, ts-function-types, ts-arrow-functions]
---*/
// number | bigint travels through closure storage; typeof selects the read branch and Node preserves the payload, branch order and printed text.
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
function slot(initial: StorageValue): { write: (value: StorageValue) => void; read: () => StorageValue } {
  let held = initial; return { write: value => { held = value; }, read: () => held };
}
const carrier = slot(5);
for (const row of rows) {
  const input: StorageValue = row.kind === "number" ? row.num : row.big;
  carrier.write(input); observe(carrier.read(), row);
}
assert.compareArray(branches, ["number", "bigint", "number", "bigint", "number", "bigint"]);
assert.compareArray(printed, ["0", "0", "NaN", "-1", "2.5", "9007199254740993"]);
