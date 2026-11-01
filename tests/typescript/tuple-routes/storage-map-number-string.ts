/*---
description: The tuple [number, string] retains every slot through map storage.
features: [ts-tuple-routes, ts-tuple-route-storage, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-interfaces, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-tuples, ts-map-set, ts-null-undefined, ts-narrowing]
---*/
// [number, string] crosses map storage; node reads the same array, length and exact slots, including signed zero, NaN and identities where present.
interface StorageRow { first: number; second: string; }
type StorageTuple = [number, string];
const rows: StorageRow[] = [
  { first: -0, second: "z" }, { first: NaN, second: "" }, { first: 8.5, second: "m" }
];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function observe(value: StorageTuple, expected: StorageRow, identity: StorageTuple): void {
  same(value, identity); same(Array.isArray(value), true); same(value.length, 2);
  same(value[0], expected.first); same(value[1], expected.second);
}
const carrier = new Map<string, StorageTuple>();
for (const round of [0, 1]) for (const row of rows) {
  const current: StorageTuple = [row.first, row.second];
  carrier.set("tuple", current); same(carrier.size, 1); same(carrier.has("tuple"), true);
  const actual = carrier.get("tuple"); if (actual === undefined) throw new Test262Error("stored tuple missing");
  observe(actual, row, current);
}
