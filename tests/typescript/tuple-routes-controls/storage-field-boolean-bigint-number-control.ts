/*---
description: Control for storage-field-boolean-bigint-number; store named slots and explicit array/count metadata.
features: [ts-tuple-routes, ts-tuple-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-interfaces, ts-typeof-operator, ts-unknown, ts-numbers, ts-bigint, ts-class, ts-class-fields]
---*/
// Replace each tuple by one record with named slots, count and an array marker; keep the same field operations, values and observations.
interface StorageRow { first: boolean; second: bigint; third: number; }
type StorageTuple = { first: boolean; second: bigint; third: number; count: number; array: boolean; };
const rows: StorageRow[] = [
  { first: false, second: 0n, third: -0 }, { first: true, second: 9007199254740993n, third: NaN },
  { first: false, second: -1n, third: 8.5 }
];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(value: StorageTuple, expected: StorageRow, identity: StorageTuple): void {
  same(value, identity); same(value.array, true); same(value.count, 3);
  same(value.first, expected.first); same(value.second, expected.second); same(value.third, expected.third);
}
class StorageBox { value: StorageTuple; constructor(value: StorageTuple) { this.value = value; } }
const carrier = new StorageBox({ first: rows[0].first, second: rows[0].second, third: rows[0].third, count: 3, array: true });
for (const round of [0, 1]) for (const row of rows) {
  const current: StorageTuple = { first: row.first, second: row.second, third: row.third, count: 3, array: true };
  carrier.value = current; observe(carrier.value, row, current);
}
