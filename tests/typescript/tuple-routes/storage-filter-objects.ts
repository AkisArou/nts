/*---
description: The tuple [StoragePoint, StoragePoint] retains every slot through filter storage.
features: [ts-tuple-routes, ts-tuple-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-interfaces, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-tuples, ts-arrow-functions]
---*/
// [StoragePoint, StoragePoint] crosses filter storage; node reads the same array, length and exact slots, including signed zero, NaN and identities where present.
interface StoragePoint { code: number; label: string; }
interface StorageRow { first: StoragePoint; second: StoragePoint; firstCode: number; secondCode: number; firstLabel: string; secondLabel: string; }
type StorageTuple = [StoragePoint, StoragePoint];
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
  same(value, identity); same(Array.isArray(value), true); same(value.length, 2);
  same(value[0], expected.first); same(value[1], expected.second);
  same(value[0].code, expected.firstCode); same(value[1].code, expected.secondCode);
  same(value[0].label, expected.firstLabel); same(value[1].label, expected.secondLabel);
}
for (const selected of [true, false]) {
  const carrier: StorageTuple[] = [], originals: StorageTuple[] = [];
  for (const row of rows) {
    const current: StorageTuple = [row.first, row.second];
    carrier.push(current); originals.push(current);
  }
  same(Array.isArray(carrier), true); same(carrier.length, rows.length);
  const visits: number[] = [];
  const result = carrier.filter((value, index) => { visits.push(index); observe(value, rows[index], originals[index]); return (value[0].label === "") === selected; });
  const order: number[] = selected ? [1] : [0, 2];
  assert.compareArray(visits, [0, 1, 2]); same(result === carrier, false); same(carrier.length, 3);
  same(result.length, order.length); same(Array.isArray(result), true);
  for (let i = 0; i < order.length; i++) { const expected = order[i]; observe(result[i], rows[expected], originals[expected]); }
}
