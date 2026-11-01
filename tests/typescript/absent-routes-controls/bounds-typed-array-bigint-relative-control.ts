/*---
description: Control for bounds-typed-array-bigint-relative; make absence explicit before reading.
features: [ts-absent-routes, ts-absent-route-bounds, ts-functions, ts-iteration, ts-typeof-operator, ts-null-undefined, ts-arrays, ts-interfaces, ts-bigint, ts-numbers, ts-objects, ts-tuples, ts-arrow-functions]
---*/
// Explicit offset and length checks return missing bigint values as undefined without indexing outside the view.
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
interface BoundsBigView { data: BigInt64Array; }
function read(holder: BoundsBigView, offset: number): bigint | undefined { const n = Number.isNaN(offset) ? 0 : Math.trunc(offset), index = n < 0 ? holder.data.length + n : n; return index >= 0 && index < holder.data.length ? holder.data[index] : undefined; }
const offsets: [number, number][] = [[-Infinity, -1], [-3, -1], [-2, 0], [-1, 1], [-0, 0], [0.8, 0], [1.8, 1], [2, -1], [NaN, 0], [Infinity, -1]];
for (const value of [0n, -1n, 9007199254740993n]) {
  const holder: BoundsBigView = { data: new BigInt64Array([value, 1n]) }, keys = ["0", "1"];
  assert.compareArray(keys, ["0", "1"]);
  assert.throws(TypeError, () => JSON.stringify(holder.data));
  for (const [offset, slot] of offsets) same(read(holder, offset), slot < 0 ? undefined : slot === 0 ? value : 1n);
  for (const index of [-1, 0, 1, 2]) {
    same(keys.includes(String(index)), index === 0 || index === 1); same(keys.includes(String(index)), index === 0 || index === 1);
  }
  same(holder.data.length, 2);
}
