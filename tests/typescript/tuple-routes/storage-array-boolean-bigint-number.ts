/*---
description: The tuple [boolean, bigint, number] retains every slot through array storage.
features: [ts-tuple-routes, ts-tuple-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-interfaces, ts-typeof-operator, ts-unknown, ts-numbers, ts-bigint, ts-tuples]
---*/
// [boolean, bigint, number] crosses array storage; node reads the same array, length and exact slots, including signed zero, NaN and identities where present.
interface StorageRow { first: boolean; second: bigint; third: number; }
type StorageTuple = [boolean, bigint, number];
const rows: StorageRow[] = [
  { first: false, second: 0n, third: -0 }, { first: true, second: 9007199254740993n, third: NaN },
  { first: false, second: -1n, third: 8.5 }
];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(value: StorageTuple, expected: StorageRow, identity: StorageTuple): void {
  same(value, identity); same(Array.isArray(value), true); same(value.length, 3);
  same(value[0], expected.first); same(value[1], expected.second); same(value[2], expected.third);
}
const carrier: StorageTuple[] = [];
for (const round of [0, 1]) for (const row of rows) {
  const current: StorageTuple = [row.first, row.second, row.third];
  carrier[0] = current; same(carrier.length, 1); same(Array.isArray(carrier), true); observe(carrier[0], row, current);
}
