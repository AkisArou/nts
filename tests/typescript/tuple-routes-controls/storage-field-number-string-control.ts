/*---
description: Control for storage-field-number-string; store named slots and explicit array/count metadata.
features: [ts-tuple-routes, ts-tuple-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-interfaces, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-class, ts-class-fields]
---*/
// Replace each tuple by one record with named slots, count and an array marker; keep the same field operations, values and observations.
interface StorageRow { first: number; second: string; }
type StorageTuple = { first: number; second: string; count: number; array: boolean; };
const rows: StorageRow[] = [
  { first: -0, second: "z" }, { first: NaN, second: "" }, { first: 8.5, second: "m" }
];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(value: StorageTuple, expected: StorageRow, identity: StorageTuple): void {
  same(value, identity); same(value.array, true); same(value.count, 2);
  same(value.first, expected.first); same(value.second, expected.second);
}
class StorageBox { value: StorageTuple; constructor(value: StorageTuple) { this.value = value; } }
const carrier = new StorageBox({ first: rows[0].first, second: rows[0].second, count: 2, array: true });
for (const round of [0, 1]) for (const row of rows) {
  const current: StorageTuple = { first: row.first, second: row.second, count: 2, array: true };
  carrier.value = current; observe(carrier.value, row, current);
}
