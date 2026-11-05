/*---
description: "BigInt64 offsets beyond the last fitting word throw RangeError and leave all bytes intact while the last fitting read succeeds."
features: [ts-dataview-routes, ts-dataview-route-bigints, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-bigint, ts-type-aliases, ts-map-set, ts-strings, ts-narrowing, ts-readonly, ts-errors, ts-arrow-functions]
---*/

// BigInt64 offsets beyond the last fitting word throw RangeError and leave all bytes intact while the last fitting read succeeds. Route: a View obtained through guarded Map.get. Node prints bigints-int64-map-nonfitting-offsets:ok.
type View = DataView;
const initial: View = new DataView(new ArrayBuffer(12)), seed: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
for (let i = 0; i < 12; i++) initial.setUint8(i, seed[i]);
const views: Map<string, View> = new Map([["wide", initial]]), offsets: readonly number[] = [5, 5.9, 8, 12, Infinity];
for (const offset of offsets) {
  const view = views.get("wide"); if (view === undefined) throw new Error("missing view");
  assert.throws(RangeError, () => view.getBigInt64(offset, false));
  assert.throws(RangeError, () => view.setBigInt64(offset, -0x1234n, false));
  const bytes: number[] = []; for (let i = 0; i < 12; i++) bytes[i] = view.getUint8(i);
  assert.compareArray(bytes, seed); assert.sameValue(view.getBigInt64(4, false), 0x05060708090a0b0cn);
}
console.log("bigints-int64-map-nonfitting-offsets:ok");
