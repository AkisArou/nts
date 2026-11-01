/*---
description: Control for storage-filter-number-string; store named slots and explicit array/count metadata.
features: [ts-tuple-routes, ts-tuple-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-interfaces, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-arrow-functions]
---*/
// Replace each tuple by one record with named slots, count and an array marker; keep the same filter operations, values and observations.
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
for (const selected of [true, false]) {
  const carrier: StorageTuple[] = [], originals: StorageTuple[] = [];
  for (const row of rows) {
    const current: StorageTuple = { first: row.first, second: row.second, count: 2, array: true };
    carrier.push(current); originals.push(current);
  }
  same(Array.isArray(carrier), true); same(carrier.length, rows.length);
  const visits: number[] = [];
  const result = carrier.filter((value, index) => { visits.push(index); observe(value, rows[index], originals[index]); return (value.second === "") === selected; });
  const order: number[] = selected ? [1] : [0, 2];
  assert.compareArray(visits, [0, 1, 2]); same(result === carrier, false); same(carrier.length, 3);
  same(result.length, order.length); same(Array.isArray(result), true);
  for (let i = 0; i < order.length; i++) { const expected = order[i]; observe(result[i], rows[expected], originals[expected]); }
}
