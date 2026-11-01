/*---
description: Control for storage-closure-objects; store named slots and explicit array/count metadata.
features: [ts-tuple-routes, ts-tuple-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-interfaces, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-arrow-functions, ts-closures]
---*/
// Replace each tuple by one record with named slots, count and an array marker; keep the same closure operations, values and observations.
interface StoragePoint { code: number; label: string; }
interface StorageRow { first: StoragePoint; second: StoragePoint; firstCode: number; secondCode: number; firstLabel: string; secondLabel: string; }
type StorageTuple = { first: StoragePoint; second: StoragePoint; count: number; array: boolean; };
const north: StoragePoint = { code: -0, label: "z" }, south: StoragePoint = { code: NaN, label: "" }, east: StoragePoint = { code: 8.5, label: "m" };
const rows: StorageRow[] = [
  { first: north, second: south, firstCode: -0, secondCode: NaN, firstLabel: "z", secondLabel: "" },
  { first: south, second: east, firstCode: NaN, secondCode: 8.5, firstLabel: "", secondLabel: "m" },
  { first: east, second: north, firstCode: 8.5, secondCode: -0, firstLabel: "m", secondLabel: "z" }
];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(value: StorageTuple, expected: StorageRow, identity: StorageTuple): void {
  same(value, identity); same(value.array, true); same(value.count, 2);
  same(value.first, expected.first); same(value.second, expected.second);
  same(value.first.code, expected.firstCode); same(value.second.code, expected.secondCode);
  same(value.first.label, expected.firstLabel); same(value.second.label, expected.secondLabel);
}
let saved: StorageTuple = { first: rows[0].first, second: rows[0].second, count: 2, array: true };
const store = (value: StorageTuple): void => { saved = value; };
const read = (): StorageTuple => saved;
for (const round of [0, 1]) for (const row of rows) {
  const current: StorageTuple = { first: row.first, second: row.second, count: 2, array: true };
  store(current); observe(read(), row, current);
}
