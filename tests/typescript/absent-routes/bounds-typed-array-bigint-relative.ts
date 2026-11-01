/*---
description: A bigint typed-array field keeps at results distinct from missing elements.
features: [ts-absent-routes, ts-absent-route-bounds, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-arrays, ts-interfaces, ts-bigint, ts-numbers, ts-objects, ts-tuples, ts-arrow-functions]
---*/
// A BigInt64Array field is read through an optional bigint result; node preserves bigint values and returns undefined outside the view.
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
interface BoundsBigView { data: BigInt64Array; }
function read(holder: BoundsBigView, offset: number): bigint | undefined { return holder.data.at(offset); }
const offsets: [number, number][] = [[-Infinity, -1], [-3, -1], [-2, 0], [-1, 1], [-0, 0], [0.8, 0], [1.8, 1], [2, -1], [NaN, 0], [Infinity, -1]];
for (const value of [0n, -1n, 9007199254740993n]) {
  const holder: BoundsBigView = { data: new BigInt64Array([value, 1n]) }, keys = Object.keys(holder.data);
  assert.compareArray(keys, ["0", "1"]);
  assert.throws(TypeError, () => JSON.stringify(holder.data));
  for (const [offset, slot] of offsets) same(read(holder, offset), slot < 0 ? undefined : slot === 0 ? value : 1n);
  for (const index of [-1, 0, 1, 2]) {
    same(index in holder.data, index === 0 || index === 1); same(Object.hasOwn(holder.data, index), index === 0 || index === 1);
  }
  same(holder.data.length, 2);
}
