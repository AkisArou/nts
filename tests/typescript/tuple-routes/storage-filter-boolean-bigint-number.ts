/*---
description: The tuple [boolean, bigint, number] retains every slot through filter storage.
features: [ts-tuple-routes, ts-tuple-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-interfaces, ts-typeof-operator, ts-unknown, ts-numbers, ts-bigint, ts-tuples, ts-arrow-functions]
---*/
// [boolean, bigint, number] crosses filter storage; node reads the same array, length and exact slots, including signed zero, NaN and identities where present.
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
for (const selected of [true, false]) {
  const carrier: StorageTuple[] = [], originals: StorageTuple[] = [];
  for (const row of rows) {
    const current: StorageTuple = [row.first, row.second, row.third];
    carrier.push(current); originals.push(current);
  }
  same(Array.isArray(carrier), true); same(carrier.length, rows.length);
  const visits: number[] = [];
  const result = carrier.filter((value, index) => { visits.push(index); observe(value, rows[index], originals[index]); return (value[1] > 1n) === selected; });
  const order: number[] = selected ? [1] : [0, 2];
  assert.compareArray(visits, [0, 1, 2]); same(result === carrier, false); same(carrier.length, 3);
  same(result.length, order.length); same(Array.isArray(result), true);
  for (let i = 0; i < order.length; i++) { const expected = order[i]; observe(result[i], rows[expected], originals[expected]); }
}
