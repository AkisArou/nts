/*---
description: The tuple [boolean, bigint, number] retains every slot through sort storage.
features: [ts-tuple-routes, ts-tuple-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-interfaces, ts-typeof-operator, ts-unknown, ts-numbers, ts-bigint, ts-tuples, ts-arrow-functions]
---*/
// [boolean, bigint, number] crosses sort storage; node reads the same array, length and exact slots, including signed zero, NaN and identities where present.
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
for (const direction of [1, -1]) {
  const carrier: StorageTuple[] = [], originals: StorageTuple[] = [];
  for (const row of rows) {
    const current: StorageTuple = [row.first, row.second, row.third];
    carrier.push(current); originals.push(current);
  }
  same(Array.isArray(carrier), true); same(carrier.length, rows.length);
  let comparisons = 0;
  const result = carrier.sort((left, right) => { comparisons++; return direction * (left[1] < right[1] ? -1 : left[1] > right[1] ? 1 : 0); });
  same(result, carrier); same(comparisons > 0, true);
  const order: number[] = direction === 1 ? [2, 0, 1] : [1, 0, 2];
  same(result.length, order.length); same(Array.isArray(result), true);
  for (let i = 0; i < order.length; i++) { const expected = order[i]; observe(result[i], rows[expected], originals[expected]); }
}
